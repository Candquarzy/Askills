use super::*;
use std::cell::RefCell;

fn cancelled() -> AtomicBool {
    AtomicBool::new(false)
}

fn success(text: &str) -> HttpResponse {
    HttpResponse {
        status: 200,
        body: serde_json::to_vec(&serde_json::json!({
            "responseStatus": 200,
            "quotaFinished": false,
            "responseData": { "translatedText": text }
        }))
        .unwrap(),
    }
}

#[derive(Default)]
struct MockTransport {
    requests: RefCell<Vec<String>>,
    replies: RefCell<VecDeque<Result<HttpResponse>>>,
    cancel_after_request: bool,
}

impl Transport for MockTransport {
    fn get(&self, text: &str, cancel: &AtomicBool) -> Result<HttpResponse> {
        assert!(!text.is_empty());
        assert!(text.len() <= MAX_SEGMENT_BYTES);
        assert!(!text.contains(['\n', '\r']));
        self.requests.borrow_mut().push(text.to_string());
        if self.cancel_after_request {
            cancel.store(true, Ordering::Relaxed);
        }
        self.replies
            .borrow_mut()
            .pop_front()
            .unwrap_or_else(|| Ok(success("译文")))
    }
}

#[test]
fn markdown_translation_preserves_frontmatter_code_links_and_original_structure() {
    let source = "\u{feff}---\r\nname: my-skill\r\ndescription: Private metadata\r\n---\r\n\r\n# Heading\r\n\r\nRead **bold words** and `secret_call()` via [guide](https://example.com/guide \"title\").\r\n\r\n```rust\r\nprintln!(\"Do not submit code\");\r\n```\r\n\r\n    indented_code()\r\n\r\n<https://example.com/auto> <person@example.com>\r\n\r\n![private image label](image.png)\r\n\r\n[fixed][] [fixed] [Visible reference][fixed]\r\n\r\n[fixed]: https://example.com/ref \"unchanged\"\r\n\r\nBefore <span>private HTML text</span> after\r\n\r\n<div>Block HTML text</div>\r\n\r\n- List words\r\n";
    let transport = MockTransport::default();
    let output = Translator::default()
        .translate_with(source, &cancelled(), &transport)
        .unwrap();
    assert!(
        output.starts_with(
            "\u{feff}---\r\nname: my-skill\r\ndescription: Private metadata\r\n---\r\n"
        )
    );
    assert!(output.contains("# 译文\r\n"));
    assert!(output.contains("**译文**"));
    assert!(output.contains("`secret_call()`"));
    assert!(output.contains("[译文](https://example.com/guide \"title\")"));
    assert!(output.contains("```rust\r\nprintln!(\"Do not submit code\");\r\n```"));
    assert!(output.contains("    indented_code()"));
    assert!(output.contains("<https://example.com/auto> <person@example.com>"));
    assert!(output.contains("![private image label](image.png)"));
    assert!(output.contains("[fixed][] [fixed] [译文][fixed]"));
    assert!(output.contains("[fixed]: https://example.com/ref \"unchanged\""));
    assert!(output.contains("Before <span>private HTML text</span> after"));
    assert!(output.contains("<div>Block HTML text</div>"));
    assert!(output.contains("- 译文\r\n"));
    let submitted = transport.requests.borrow().join(" ");
    for secret in [
        "Private",
        "secret_call",
        "println",
        "indented_code",
        "https",
        "person@",
        "private",
        "fixed",
        "Block HTML",
    ] {
        assert!(
            !submitted.contains(secret),
            "unexpected text submitted: {secret}"
        );
    }
}

#[test]
fn chunks_respect_utf8_byte_limit_and_preserve_original_whitespace() {
    let source = format!("  {}\n\nSecond paragraph", "Aé中🙂 word. ".repeat(90));
    let segments = translation_segments(&source, &cancelled()).unwrap();
    assert!(segments.len() > 2);
    let mut copied = 0;
    let mut reconstructed = String::new();
    for range in &segments {
        assert!(source.is_char_boundary(range.start));
        assert!(source.is_char_boundary(range.end));
        assert!(range.len() <= MAX_SEGMENT_BYTES);
        let segment = &source[range.clone()];
        assert!(!segment.contains('\n'));
        reconstructed.push_str(&source[copied..range.start]);
        reconstructed.push_str(segment);
        copied = range.end;
    }
    reconstructed.push_str(&source[copied..]);
    assert_eq!(source, reconstructed);
    let transport = MockTransport::default();
    let translated = Translator::default()
        .translate_with(&source, &cancelled(), &transport)
        .unwrap();
    assert!(translated.starts_with("  译文"));
    assert!(translated.contains("\n\n译文"));
    assert!(transport.requests.borrow().len() > 2);
}

#[test]
fn translations_cannot_inject_markdown_html_or_new_blocks() {
    let transport = MockTransport::default();
    transport.replies.borrow_mut().push_back(Ok(success(
        "<script>alert('x')</script>\n# title\n[click](javascript:x) | `code` &copy;",
    )));
    let translated = Translator::default()
        .translate_with("Hello", &cancelled(), &transport)
        .unwrap();
    assert!(!translated.contains('\n'));
    assert!(translated.contains("\\<script\\>"));
    let events: Vec<_> = Parser::new_ext(&translated, Options::all()).collect();
    assert!(!events.iter().any(|event| matches!(
        event,
        Event::Html(_)
            | Event::InlineHtml(_)
            | Event::Code(_)
            | Event::Start(Tag::Link { .. })
            | Event::Start(Tag::Heading { .. })
    )));
}

#[test]
fn entity_encoded_translation_is_readable_without_html_or_markdown_execution() {
    let transport = MockTransport::default();
    transport.replies.borrow_mut().push_back(Ok(success(
        "译文：&quot;标题&quot; &amp; &#39;示例&apos; &#x4E2D;&#25991; &#X1F642; &lt;script&gt;alert(1)&lt;/script&gt; &#91;链接&#93;&#40;javascript:x&#41; &amp;lt;",
    )));
    let translated = Translator::default()
        .translate_with("Hello world", &cancelled(), &transport)
        .unwrap();
    let mut rendered = String::new();
    for event in Parser::new_ext(&translated, Options::all()) {
        match event {
            Event::Text(text) => rendered.push_str(&text),
            Event::Html(_)
            | Event::InlineHtml(_)
            | Event::Code(_)
            | Event::Start(Tag::Link { .. }) => panic!("translation introduced active markup"),
            _ => {}
        }
    }
    assert_eq!(
        rendered,
        "译文：\"标题\" & '示例' 中文 🙂 <script>alert(1)</script> [链接](javascript:x) &lt;"
    );
    assert_eq!(
        decode_entities("&unknown; &#xD800; &#1114112; &#-1; &#x; &unterminated").unwrap(),
        "&unknown; &#xD800; &#1114112; &#-1; &#x; &unterminated"
    );
}

#[test]
fn entity_encoded_controls_are_rejected_before_cache_or_output() {
    for code in (0_u32..=31).chain(127..=159) {
        for encoded in [format!("文字&#{code};"), format!("文字&#x{code:x};")] {
            let mut translator = Translator::default();
            let transport = MockTransport::default();
            transport
                .replies
                .borrow_mut()
                .push_back(Ok(success(&encoded)));
            assert_eq!(
                translator
                    .translate_with("Hello", &cancelled(), &transport)
                    .unwrap_err()
                    .code,
                "TranslationResponse"
            );
            assert!(translator.cache.is_empty());
        }
    }
    // Raw ordinary whitespace is normalized by the renderer, while other
    // whitespace controls such as form-feed and NEXT LINE are rejected too.
    assert_eq!(
        escape_markdown(&decode_response(success("甲\n\r\t乙")).unwrap()),
        "甲   乙"
    );
    for control in ['\u{b}', '\u{c}', '\u{85}'] {
        assert!(decode_response(success(&format!("译文{control}"))).is_err());
    }
}

#[test]
fn response_validation_rejects_quota_http_errors_and_embedded_service_failures() {
    for status in [serde_json::json!(200), serde_json::json!("200")] {
        assert_eq!(decode_response(HttpResponse {
            status: 200,
            body: serde_json::to_vec(&serde_json::json!({"responseStatus": status, "quotaFinished": null, "responseData": {"translatedText": "你好"}})).unwrap()
        }).unwrap(), "你好");
    }
    for (http_status, status, quota, expected) in [
        (200, "403", false, "TranslationRejected"),
        (200, "200", true, "TranslationQuota"),
        (200, "429", false, "TranslationQuota"),
        (429, "200", false, "TranslationQuota"),
        (302, "200", false, "TranslationHttp"),
        (500, "200", false, "TranslationHttp"),
    ] {
        let result = decode_response(HttpResponse {
            status: http_status,
            body: serde_json::to_vec(&serde_json::json!({"responseStatus": status, "quotaFinished": quota, "responseData": {"translatedText": "PRIVATE SENTINEL"}})).unwrap(),
        });
        let error = result.unwrap_err();
        assert_eq!(error.code, expected);
        assert!(!error.message.contains("PRIVATE SENTINEL"));
    }
    assert_eq!(
        decode_response(HttpResponse {
            status: 200,
            body: vec![b'x'; MAX_RESPONSE_BYTES + 1]
        })
        .unwrap_err()
        .code,
        "TranslationLimit"
    );
    assert_eq!(
        decode_response(success(&"字".repeat(MAX_TRANSLATED_BYTES)))
            .unwrap_err()
            .code,
        "TranslationResponse"
    );
    assert_eq!(
        decode_response(success("\0bad")).unwrap_err().code,
        "TranslationResponse"
    );
}

#[test]
fn cancelled_translation_never_returns_a_partial_document_or_starts_more_requests() {
    let cancel = AtomicBool::new(true);
    let transport = MockTransport::default();
    assert_eq!(
        Translator::default()
            .translate_with("Hello", &cancel, &transport)
            .unwrap_err()
            .code,
        "Cancelled"
    );
    assert!(transport.requests.borrow().is_empty());
    cancel.store(false, Ordering::Relaxed);
    let transport = MockTransport {
        cancel_after_request: true,
        ..Default::default()
    };
    assert_eq!(
        Translator::default()
            .translate_with("First paragraph\n\nSecond paragraph", &cancel, &transport)
            .unwrap_err()
            .code,
        "Cancelled"
    );
    assert_eq!(transport.requests.borrow().len(), 1);
}

#[test]
fn successful_segments_are_cached_but_failure_does_not_return_a_partial_translation() {
    let mut translator = Translator::default();
    let transport = MockTransport::default();
    transport.replies.borrow_mut().extend([
        Ok(success("第一段")),
        Err(quota_error()),
        Ok(success("第二段")),
    ]);
    let source = "First paragraph\n\nSecond paragraph";
    assert_eq!(
        translator
            .translate_with(source, &cancelled(), &transport)
            .unwrap_err()
            .code,
        "TranslationQuota"
    );
    assert_eq!(transport.requests.borrow().len(), 2);
    assert_eq!(translator.cache.len(), 1);
    assert_eq!(
        translator
            .translate_with(source, &cancelled(), &transport)
            .unwrap(),
        "第一段\n\n第二段"
    );
    assert_eq!(transport.requests.borrow().len(), 3);
    assert_eq!(
        translator
            .translate_with(source, &cancelled(), &transport)
            .unwrap(),
        "第一段\n\n第二段"
    );
    assert_eq!(transport.requests.borrow().len(), 3);
}

#[test]
fn session_cache_is_bounded_and_drops_old_entries() {
    let mut translator = Translator::default();
    let first = cache_key("first");
    translator.remember(first, "第一段".into());
    for index in 0..MAX_CACHE_ENTRIES + 10 {
        translator.remember(cache_key(&format!("{index}")), "字".repeat(2_000));
    }
    assert!(translator.cache.len() <= MAX_CACHE_ENTRIES);
    assert!(translator.cache_bytes <= MAX_CACHE_BYTES);
    assert_eq!(translator.cache.len(), translator.order.len());
    assert!(!translator.cache.contains_key(&first));
    assert_eq!(
        translator.cache_bytes,
        translator
            .cache
            .values()
            .map(|text| text.len() + 32)
            .sum::<usize>()
    );
}

#[test]
fn invalid_or_oversized_documents_fail_before_network_and_chinese_needs_no_request() {
    let transport = MockTransport::default();
    let mut translator = Translator::default();
    for source in [
        "a".repeat(MAX_INPUT_BYTES + 1),
        "---\nprivate: Never send me".to_string(),
        "Hello\n\n".repeat(MAX_SEGMENTS + 1),
    ] {
        assert!(
            translator
                .translate_with(&source, &cancelled(), &transport)
                .is_err()
        );
    }
    let chinese = "# 中文标题\n\n这里只含中文。\n\n```rust\nsecret_code()\n```";
    assert_eq!(
        translator
            .translate_with(chinese, &cancelled(), &transport)
            .unwrap(),
        chinese
    );
    assert!(transport.requests.borrow().is_empty());
}

#[test]
#[ignore = "contacts the official MyMemory endpoint with only the public sample Hello world"]
fn live_mymemory_hello_world() {
    let output = Translator::default()
        .translate_markdown("Hello world", &cancelled())
        .unwrap();
    assert!(!output.trim().is_empty());
    assert!(
        output
            .chars()
            .any(|ch| ('\u{4e00}'..='\u{9fff}').contains(&ch))
    );
}
