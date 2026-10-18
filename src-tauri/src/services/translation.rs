//! Optional, user-initiated reading translation. Source files are never modified.
//!
//! MyMemory's public API accepts at most 500 UTF-8 bytes per segment. Requests
//! remain within one Markdown text node (and hence one paragraph). No email,
//! credentials, configurable endpoint, or persistent cache is involved.

use crate::domain::{AppError, Result};
use crate::platform::fs::check_cancel;
use pulldown_cmark::{Event, LinkType, Options, Parser, Tag, TagEnd};
use reqwest::{blocking::Client, redirect::Policy};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::ops::Range;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const ENDPOINT: &str = "https://api.mymemory.translated.net/get";
const LANGUAGE_PAIR: &str = "en|zh-CN";
const MAX_INPUT_BYTES: usize = 256 * 1024;
const MAX_SEGMENT_BYTES: usize = 500;
const MAX_SEGMENTS: usize = 512;
const MAX_MARKDOWN_EVENTS: usize = 32_768;
const MAX_RESPONSE_BYTES: usize = 128 * 1024;
const MAX_TRANSLATED_BYTES: usize = 8 * 1024;
const MAX_OUTPUT_BYTES: usize = 1024 * 1024;
const MAX_CACHE_ENTRIES: usize = 512;
const MAX_CACHE_BYTES: usize = 2 * 1024 * 1024;

/// Bounded in-memory cache belonging to one running application session.
#[derive(Default)]
pub struct Translator {
    cache: HashMap<[u8; 32], String>,
    order: VecDeque<[u8; 32]>,
    cache_bytes: usize,
}

impl Translator {
    pub fn translate_markdown(&mut self, markdown: &str, cancel: &AtomicBool) -> Result<String> {
        check_cancel(cancel)?;
        self.translate_with(markdown, cancel, &MyMemory::new()?)
    }

    fn translate_with(
        &mut self,
        markdown: &str,
        cancel: &AtomicBool,
        transport: &impl Transport,
    ) -> Result<String> {
        check_cancel(cancel)?;
        let segments = translation_segments(markdown, cancel)?;
        let mut output = String::with_capacity(markdown.len());
        let mut copied = 0;
        for range in segments {
            check_cancel(cancel)?;
            let text = &markdown[range.clone()];
            let key = cache_key(text);
            let translated = if let Some(cached) = self.cache.get(&key) {
                cached.clone()
            } else {
                let response = transport.get(text, cancel)?;
                check_cancel(cancel)?;
                let translated = decode_response(response)?;
                self.remember(key, translated.clone());
                translated
            };
            let escaped = escape_markdown(&translated);
            if output.len() + range.start - copied + escaped.len() > MAX_OUTPUT_BYTES {
                return Err(limit_error("翻译结果超过 1 MiB，请缩短文档后重试"));
            }
            output.push_str(&markdown[copied..range.start]);
            output.push_str(&escaped);
            copied = range.end;
        }
        check_cancel(cancel)?;
        if output.len() + markdown.len() - copied > MAX_OUTPUT_BYTES {
            return Err(limit_error("翻译结果超过 1 MiB，请缩短文档后重试"));
        }
        output.push_str(&markdown[copied..]);
        // Only complete translations leave this function. Successful segments
        // may stay cached after a later failure to make a retry less expensive.
        Ok(output)
    }

    fn remember(&mut self, key: [u8; 32], translated: String) {
        let bytes = key.len() + translated.len();
        if bytes > MAX_CACHE_BYTES || self.cache.contains_key(&key) {
            return;
        }
        while self.cache.len() >= MAX_CACHE_ENTRIES || self.cache_bytes + bytes > MAX_CACHE_BYTES {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(value) = self.cache.remove(&oldest) {
                self.cache_bytes -= oldest.len() + value.len();
            }
        }
        self.cache_bytes += bytes;
        self.cache.insert(key, translated);
        self.order.push_back(key);
    }
}

fn cache_key(text: &str) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"mymemory\0");
    hash.update(LANGUAGE_PAIR);
    hash.update(b"\0");
    hash.update(text);
    hash.finalize().into()
}

fn limit_error(message: &str) -> AppError {
    AppError::new("TranslationLimit", message)
}

fn response_error() -> AppError {
    AppError::new("TranslationResponse", "翻译服务返回了无效结果，请稍后重试")
}

fn quota_error() -> AppError {
    AppError::new(
        "TranslationQuota",
        "MyMemory 的翻译额度已用尽或触发限流；匿名额度为每天 5,000 字符，请稍后重试",
    )
}

/// Strip only the parser's view of frontmatter, preserving its original bytes.
fn body_start(markdown: &str) -> Result<usize> {
    let bom = if markdown.starts_with('\u{feff}') {
        3
    } else {
        0
    };
    let mut lines = markdown[bom..].split_inclusive('\n');
    let Some(first) = lines.next() else {
        return Ok(bom);
    };
    if first.trim_end_matches(['\r', '\n']) != "---" {
        return Ok(bom);
    }
    let mut offset = bom + first.len();
    for line in lines {
        offset += line.len();
        if matches!(line.trim_end_matches(['\r', '\n']), "---" | "...") {
            return Ok(offset);
        }
    }
    Err(AppError::new(
        "TranslationMarkdown",
        "文档的 YAML frontmatter 缺少结束分隔符，未发送任何内容",
    ))
}

fn translation_segments(markdown: &str, cancel: &AtomicBool) -> Result<Vec<Range<usize>>> {
    if markdown.len() > MAX_INPUT_BYTES {
        return Err(limit_error("待翻译文档超过 256 KiB"));
    }
    let offset = body_start(markdown)?;
    let body = &markdown[offset..];
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_HEADING_ATTRIBUTES
        | Options::ENABLE_MATH;
    let mut excluded = Vec::<Range<usize>>::new();
    let mut text_ranges = Vec::<Range<usize>>::new();
    let mut blocks = Vec::<(TagEnd, Range<usize>)>::new();
    for (index, (event, range)) in Parser::new_ext(body, options)
        .into_offset_iter()
        .enumerate()
    {
        check_cancel(cancel)?;
        if index >= MAX_MARKDOWN_EVENTS {
            return Err(limit_error("待翻译文档的 Markdown 结构过于复杂"));
        }
        match event {
            Event::Start(tag) => {
                let protected = matches!(
                    tag,
                    Tag::CodeBlock(_) | Tag::HtmlBlock | Tag::Image { .. } | Tag::MetadataBlock(_)
                ) || matches!(
                    tag,
                    Tag::Link { link_type, .. }
                        if !matches!(link_type, LinkType::Inline | LinkType::Reference)
                );
                if protected {
                    excluded.push(range.clone());
                }
                blocks.push((tag.to_end(), range));
            }
            Event::End(_) => {
                blocks.pop();
            }
            Event::InlineHtml(_) => {
                // HTML may surround text events. Preserve the containing text
                // block conservatively instead of translating inside HTML.
                let containing = blocks.iter().rev().find(|(tag, _)| {
                    matches!(
                        tag,
                        TagEnd::Paragraph | TagEnd::Heading(_) | TagEnd::TableCell | TagEnd::Item
                    )
                });
                excluded.push(containing.map_or(range, |(_, block)| block.clone()));
            }
            Event::Text(text) if body[range.clone()] == *text => {
                // A differing source range contains escapes/entities; leaving
                // it untouched preserves their exact original syntax.
                text_ranges.push(range);
            }
            _ => {}
        }
    }
    excluded.sort_unstable_by_key(|range| (range.start, range.end));
    let mut merged = Vec::<Range<usize>>::new();
    for range in excluded {
        if let Some(previous) = merged.last_mut()
            && range.start <= previous.end
        {
            previous.end = previous.end.max(range.end);
        } else {
            merged.push(range);
        }
    }
    let mut segments = Vec::new();
    let mut blocked_index = 0;
    for range in text_ranges {
        check_cancel(cancel)?;
        while merged
            .get(blocked_index)
            .is_some_and(|blocked| blocked.end <= range.start)
        {
            blocked_index += 1;
        }
        if merged
            .get(blocked_index)
            .is_some_and(|blocked| blocked.start < range.end)
        {
            continue;
        }
        // Text events generally exclude line breaks. Splitting defensively
        // keeps even unusual text nodes within a single service paragraph.
        let mut line_start = range.start;
        for line in body[range].split_inclusive('\n') {
            add_chunks(
                body,
                line_start..line_start + line.len(),
                offset,
                &mut segments,
            )?;
            line_start += line.len();
        }
    }
    Ok(segments)
}

fn add_chunks(
    body: &str,
    mut range: Range<usize>,
    offset: usize,
    segments: &mut Vec<Range<usize>>,
) -> Result<()> {
    range.start += body[range.clone()].len() - body[range.clone()].trim_start().len();
    range.end = range.start + body[range.clone()].trim_end().len();
    while range.start < range.end {
        let text = &body[range.clone()];
        let mut end = text.len().min(MAX_SEGMENT_BYTES);
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        if end < text.len() {
            // Prefer a nearby word/sentence boundary, but always advance even
            // through long identifiers and multibyte Unicode sequences.
            if let Some(boundary) = text[..end]
                .char_indices()
                .rev()
                .find(|(index, ch)| {
                    *index >= MAX_SEGMENT_BYTES / 2
                        && (ch.is_whitespace() || matches!(ch, '.' | '!' | '?' | ';' | ','))
                })
                .map(|(index, ch)| index + ch.len_utf8())
            {
                end = boundary;
            }
        }
        let chunk = &text[..end];
        let leading = chunk.len() - chunk.trim_start().len();
        let trimmed = chunk.trim();
        if trimmed.bytes().any(|byte| byte.is_ascii_alphabetic()) {
            if segments.len() >= MAX_SEGMENTS {
                return Err(limit_error("待翻译文本超过 512 个片段，请缩短文档后重试"));
            }
            let start = offset + range.start + leading;
            segments.push(start..start + trimmed.len());
        }
        range.start += end;
    }
    Ok(())
}

fn escape_markdown(translated: &str) -> String {
    let mut escaped = String::with_capacity(translated.len());
    for ch in translated.trim().chars() {
        if ch.is_ascii_punctuation() {
            escaped.push('\\');
        }
        // A translator cannot create paragraphs, lists, or fenced blocks.
        escaped.push(if ch.is_whitespace() { ' ' } else { ch });
    }
    escaped
}

struct HttpResponse {
    status: u16,
    body: Vec<u8>,
}

/// Private transport allows deterministic tests without configurable origins.
trait Transport {
    fn get(&self, text: &str, cancel: &AtomicBool) -> Result<HttpResponse>;
}

struct MyMemory {
    client: Client,
}

impl MyMemory {
    fn new() -> Result<Self> {
        let client = Client::builder()
            .user_agent(concat!("Askills/", env!("CARGO_PKG_VERSION")))
            .https_only(true)
            .redirect(Policy::none())
            .referer(false)
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(25))
            .build()
            .map_err(|_| AppError::new("TranslationClient", "无法初始化翻译 HTTPS 客户端"))?;
        Ok(Self { client })
    }
}

impl Transport for MyMemory {
    fn get(&self, text: &str, cancel: &AtomicBool) -> Result<HttpResponse> {
        check_cancel(cancel)?;
        if text.is_empty() || text.len() > MAX_SEGMENT_BYTES {
            return Err(limit_error("单个翻译片段必须为 1–500 个 UTF-8 字节"));
        }
        let mut response = self
            .client
            .get(ENDPOINT)
            .query(&[("q", text), ("langpair", LANGUAGE_PAIR)])
            .send()
            .map_err(|error| {
                if cancel.load(Ordering::Relaxed) {
                    AppError::new("Cancelled", "操作已取消")
                } else if error.is_timeout() {
                    AppError::new("TranslationTimeout", "翻译请求超时，请检查网络后重试")
                } else {
                    // reqwest errors can include the URL and submitted text.
                    AppError::new(
                        "TranslationNetwork",
                        "无法连接 MyMemory，请检查网络或代理设置",
                    )
                }
            })?;
        check_cancel(cancel)?;
        let status = response.status().as_u16();
        if status != 200 {
            return Ok(HttpResponse {
                status,
                body: Vec::new(),
            });
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
        {
            return Err(limit_error("翻译服务响应超过 128 KiB"));
        }
        let mut body = Vec::new();
        let mut buffer = [0_u8; 8192];
        loop {
            check_cancel(cancel)?;
            let count = response.read(&mut buffer).map_err(|_| {
                if cancel.load(Ordering::Relaxed) {
                    AppError::new("Cancelled", "操作已取消")
                } else {
                    AppError::new("TranslationRead", "读取翻译结果失败或超时，请重试")
                }
            })?;
            if count == 0 {
                break;
            }
            if body.len() + count > MAX_RESPONSE_BYTES {
                return Err(limit_error("翻译服务响应超过 128 KiB"));
            }
            body.extend_from_slice(&buffer[..count]);
        }
        check_cancel(cancel)?;
        Ok(HttpResponse { status, body })
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ResponseStatus {
    Number(u16),
    Text(String),
}

impl ResponseStatus {
    fn number(&self) -> Option<u16> {
        match self {
            Self::Number(number) => Some(*number),
            Self::Text(text) => text.parse().ok(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranslationResponse {
    response_status: ResponseStatus,
    quota_finished: Option<bool>,
    response_data: TranslationData,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranslationData {
    translated_text: String,
}

fn decode_response(response: HttpResponse) -> Result<String> {
    if response.status == 429 {
        return Err(quota_error());
    }
    if response.status != 200 {
        return Err(AppError::new(
            "TranslationHttp",
            format!("翻译服务返回 HTTP {}，请稍后重试", response.status),
        ));
    }
    if response.body.len() > MAX_RESPONSE_BYTES {
        return Err(limit_error("翻译服务响应超过 128 KiB"));
    }
    let result: TranslationResponse =
        serde_json::from_slice(&response.body).map_err(|_| response_error())?;
    if result.quota_finished == Some(true) || result.response_status.number() == Some(429) {
        return Err(quota_error());
    }
    if result.response_status.number() != Some(200) {
        return Err(AppError::new(
            "TranslationRejected",
            "MyMemory 拒绝了翻译请求，可能是额度或语言限制；请稍后重试",
        ));
    }
    let encoded = result.response_data.translated_text;
    if encoded.len() > MAX_TRANSLATED_BYTES {
        return Err(response_error());
    }
    let text = decode_entities(&encoded)?;
    if text.trim().is_empty()
        || text.len() > MAX_TRANSLATED_BYTES
        || text
            .chars()
            .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
    {
        return Err(response_error());
    }
    Ok(text)
}

/// Translate providers can return HTML entities in an otherwise plain-text
/// field. Decode once, then let escape_markdown render the result as text.
/// Unknown/malformed entities stay literal; this is not an HTML parser.
fn decode_entities(encoded: &str) -> Result<String> {
    let mut decoded = String::with_capacity(encoded.len());
    let mut remaining = encoded;
    while let Some(start) = remaining.find('&') {
        decoded.push_str(&remaining[..start]);
        remaining = &remaining[start..];
        let end = remaining.bytes().take(16).position(|byte| byte == b';');
        let character = end.and_then(|end| {
            let entity = &remaining[1..end];
            match entity {
                "amp" => Some('&'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "nbsp" => Some('\u{a0}'),
                _ => {
                    let numeric = entity.strip_prefix('#')?;
                    let (digits, radix) = numeric
                        .strip_prefix(['x', 'X'])
                        .map_or((numeric, 10), |digits| (digits, 16));
                    if digits.is_empty()
                        || !digits.chars().all(|ch| match radix {
                            16 => ch.is_ascii_hexdigit(),
                            _ => ch.is_ascii_digit(),
                        })
                    {
                        return None;
                    }
                    u32::from_str_radix(digits, radix)
                        .ok()
                        .and_then(char::from_u32)
                }
            }
        });
        if let (Some(character), Some(end)) = (character, end) {
            // Reject every entity-encoded control, including encoded line
            // breaks, before the decoded result enters the session cache.
            if character.is_control() {
                return Err(response_error());
            }
            decoded.push(character);
            remaining = &remaining[end + 1..];
        } else {
            decoded.push('&');
            remaining = &remaining[1..];
        }
    }
    decoded.push_str(remaining);
    Ok(decoded)
}

#[cfg(test)]
mod tests;
