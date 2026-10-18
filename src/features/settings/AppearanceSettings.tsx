import { useEffect, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import type { Appearance } from "../../lib/ipc/types";
import {
  ACCENT_PRESETS,
  DEFAULT_APPEARANCE,
  isAccentColor,
  accentPalette,
} from "../../app/appearance";

export function AppearanceSettings({
  value,
  busy,
  save,
}: {
  value: Appearance;
  busy: boolean;
  save: (appearance: Appearance) => void;
}) {
  const [draft, setDraft] = useState(value.accentColor);
  useEffect(() => {
    setDraft(value.accentColor);
  }, [value.accentColor]);
  const valid = isAccentColor(draft);
  return (
    <section className="settings-section appearance-settings">
      <div className="appearance-heading">
        <div>
          <h2>个性化</h2>
          <p className="muted">WinUI 风格 · 用喜欢的颜色布置工作空间</p>
        </div>
        <button
          disabled={busy}
          onClick={() => {
            setDraft(DEFAULT_APPEARANCE.accentColor);
            save({ ...DEFAULT_APPEARANCE });
          }}
        >
          <RotateCcw size={15} />
          恢复默认
        </button>
      </div>
      <label className="field">
        外观模式
        <select
          aria-label="外观模式"
          value={value.mode}
          disabled={busy}
          onChange={(event) =>
            save({ ...value, mode: event.target.value as Appearance["mode"] })
          }
        >
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </label>
      <div className="appearance-label" id="accent-label">
        主题色
      </div>
      <div
        className="accent-presets"
        role="group"
        aria-labelledby="accent-label"
      >
        {ACCENT_PRESETS.map((preset) => (
          <button
            key={preset.color}
            disabled={busy}
            aria-label={preset.name}
            aria-pressed={value.accentColor === preset.color}
            className="accent-preset"
            onClick={() => {
              setDraft(preset.color);
              save({ ...value, accentColor: preset.color });
            }}
          >
            <span
              className="accent-swatch"
              style={{ backgroundColor: preset.color }}
            >
              {value.accentColor === preset.color && (
                <Check
                  size={17}
                  style={{
                    color: accentPalette(preset.color, false).foreground,
                  }}
                />
              )}
            </span>
            <span>{preset.name}</span>
          </button>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !busy)
            save({ ...value, accentColor: draft.toLowerCase() });
        }}
      >
        <label className="field" htmlFor="custom-accent">
          自定义颜色
        </label>
        <div className="custom-accent-row">
          <input
            type="color"
            aria-label="选择自定义颜色"
            value={valid ? draft : value.accentColor}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
          />
          <input
            id="custom-accent"
            aria-label="自定义颜色"
            value={draft}
            maxLength={7}
            spellCheck={false}
            aria-invalid={!valid}
            aria-describedby={!valid ? "accent-error" : undefined}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className="primary" disabled={busy || !valid} type="submit">
            应用自定义颜色
          </button>
        </div>
        {!valid && (
          <p id="accent-error" className="candidate-error">
            请输入 #RRGGBB 格式的六位颜色。
          </p>
        )}
      </form>
      <p className="footnote">
        主题色用于按钮、选择状态与焦点提示。设置会自动保存，重启后保留。
      </p>
    </section>
  );
}
