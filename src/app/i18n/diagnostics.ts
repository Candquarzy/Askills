import type { Locale } from "../../lib/ipc/types";
import { translate, type Parameters } from "./messages";

// Native errors retain stable codes. Translate the summary and keep unknown
// diagnostics verbatim so filesystem paths and upstream output are not lost.
const summaries: Record<string, string> = {
  SelectionExpired: "The folder selection expired. Choose it again.",
  InvalidSelection: "The folder selection is invalid for this operation.",
  SelectionLimit:
    "Too many pending folder selections. Finish the current operation first.",
  PreviewLimit: "Finish or close other import previews first.",
  Busy: "Another operation is running. Wait for it or cancel it before retrying.",
  StateUnavailable: "Application state is unavailable. Restart Askills.",
  PreviewExpired: "The import preview expired. Preview the skill again.",
  CatalogExpired: "The source list expired. Find skills again.",
  Cancelled: "Operation cancelled.",
  cancelled: "GitHub operation cancelled.",
  InvalidPath: "The path is invalid.",
  InvalidDirectory: "Choose a regular directory.",
  UnsafeLink: "The path contains a symbolic link or reparse point.",
  UnsafeFile: "The path is not a regular file.",
  LimitExceeded: "The operation exceeds a file, size or depth limit.",
  PathConflict: "The destination conflicts with existing content.",
  SourceChanged: "Source files changed while reading. Preview again.",
  InvalidSkill: "The skill does not contain valid SKILL.md metadata.",
  ReferenceEscape: "A Markdown reference points outside the skill folder.",
  GitNotInstalled:
    "Git was not found. Install Git and restart Askills, or switch to GitHub API.",
  GitVersion: "A valid Git installation was not detected.",
  GitLaunch: "Local Git could not be started.",
  GitTimeout:
    "Git timed out. Check your network, proxy and credential settings.",
  GitFailed:
    "Git failed. Check the repository, revision, proxy and configured credentials. Interactive sign-in is disabled. You can also switch to GitHub API.",
  GitLimit:
    "The repository or Git output exceeds the download limits. Try GitHub API or a local import.",
  GitReference: "The Git revision is invalid.",
  github_repository:
    "Enter owner/repository or an HTTPS GitHub repository URL. Use the separate field for the branch, tag or commit.",
  github_reference: "The branch, tag or commit is invalid.",
  github_timeout: "GitHub timed out. Check your network and retry.",
  github_network: "Could not connect to GitHub. Check your network or proxy.",
  github_rate_limit:
    "GitHub's request quota or rate limit was reached. Retry later or use local Git.",
  github_not_found:
    "Public repository or revision not found. Check your input. GitHub API mode supports public repositories only.",
  github_forbidden:
    "GitHub denied access. The repository may require authentication or requests may be temporarily limited.",
  github_private: "GitHub API mode supports public repositories only.",
  github_tree_truncated:
    "The repository tree is too large or incomplete. Import a complete local skill folder instead.",
  github_no_skills: "No file named exactly SKILL.md was found at this commit.",
  github_blob_integrity: "Downloaded file integrity verification failed.",
  InvalidAccentColor: "Enter a six-digit color in #RRGGBB format.",
  LibraryBusy:
    "Another Askills instance is using this data directory or library.",
  LibraryChanged:
    "The library directory was replaced externally. Restart and inspect it.",
  LibraryNotEmpty: "Changing the library location requires an empty library.",
  LibraryInUse:
    "The library location cannot change while deployments or recovery records exist.",
  SkillNotFound: "The skill no longer exists.",
  RevisionNotFound: "The version no longer exists.",
  DriftDetected:
    "A library version was modified externally. Reimport it from its source.",
  SkillIdentityChanged:
    "The skill name changed across versions. Verify its source before importing it as a separate local skill.",
  InvalidDisplayName:
    "Display names may contain up to 80 characters, without line breaks or control characters.",
  InvalidProject: "A project cannot contain the library or be inside it.",
  ProjectNotFound: "The project no longer exists.",
  PermissionDenied:
    "Permission denied. Check access to the affected file or directory.",
  PathNotFound: "The file or directory could not be found.",
  WriteFailed: "Settings could not be saved. Retry the operation.",
};

export function diagnostic(
  message: string,
  locale: Locale,
  parameters?: Parameters,
): string {
  const translated = translate(message, locale, parameters);
  if (locale !== "en" || translated !== message) return translated;
  const nameMismatch =
    /^来源目录名与 name 不同；项目安装目录将使用 (.+)，原文件保持不变$/.exec(
      message,
    );
  if (nameMismatch)
    return `The source folder name differs from the skill name. The project folder will be named ${nameMismatch[1]}. Original files are unchanged.`;
  return message;
}

export function nativeError(
  code: string,
  message: string,
  locale: Locale,
): string {
  const detail = diagnostic(message, locale);
  if (
    locale !== "en" ||
    detail !== message ||
    !Object.prototype.hasOwnProperty.call(summaries, code)
  )
    return detail;
  // The original diagnostic is useful when reporting unexpected native errors.
  return `${summaries[code]}\nDetails (original): ${message}`;
}
