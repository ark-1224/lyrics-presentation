import type { ReactNode } from "react";
import { DEFAULT_SETTINGS, FONTS } from "../../shared/types";
import type { Align, DisplayState, DisplayStyle, FontKey, PresentationSettings } from "../../shared/types";
import type { DeepPartialSettings, Video } from "./api";
import { DisplayView } from "./DisplayView";

interface Props {
  settings: PresentationSettings;
  videos: Video[];
  /** Text shown in the previews (the live or first slide, or a sample). */
  sampleText: string;
  onChange: (patch: DeepPartialSettings) => void;
  onManageVideos: () => void;
}

const ALIGN_OPTIONS: { value: Align; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

function Slider({ label, value, min, max, step, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span>
        {label} <output>{format(value)}</output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/** Controls shared by both displays: font, size, color, alignment, vertical position, outline. */
function StyleControls({ style, onChange }: { style: DisplayStyle; onChange: (patch: Partial<DisplayStyle>) => void }) {
  return (
    <div className="style-controls">
      <label className="field">
        <span>Font</span>
        <select value={style.font} onChange={(e) => onChange({ font: e.target.value as FontKey })}>
          {(Object.keys(FONTS) as FontKey[]).map((key) => (
            <option key={key} value={key}>
              {FONTS[key].label}
            </option>
          ))}
        </select>
      </label>
      <Slider label="Text size" value={style.fontSize} min={2} max={20} step={0.5} format={(v) => `${v}% of screen height`} onChange={(fontSize) => onChange({ fontSize })} />
      <label className="field">
        <span>Text color</span>
        <input type="color" value={style.color} onChange={(e) => onChange({ color: e.target.value })} />
      </label>
      <fieldset className="field align">
        <legend>Alignment</legend>
        <div className="segmented" role="group" aria-label="Alignment">
          {ALIGN_OPTIONS.map((o) => (
            <button key={o.value} type="button" aria-pressed={style.align === o.value} className={style.align === o.value ? "active" : ""} onClick={() => onChange({ align: o.value })}>
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>
      <Slider
        label="Vertical position"
        value={style.vertical}
        min={0}
        max={100}
        step={1}
        format={(v) => (v <= 5 ? "top" : v >= 95 ? "bottom" : v === 50 ? "middle" : `${v}%`)}
        onChange={(vertical) => onChange({ vertical })}
      />
      <Slider
        label="Outline / shadow"
        value={style.shadow}
        min={0}
        max={10}
        step={0.5}
        format={(v) => (v === 0 ? "off" : String(v))}
        onChange={(shadow) => onChange({ shadow })}
      />
      <label className="field checkbox">
        <input type="checkbox" checked={style.bold} onChange={(e) => onChange({ bold: e.target.checked })} />
        <span>Bold text</span>
      </label>
    </div>
  );
}

function Section({ title, preview, children, onReset }: { title: string; preview: ReactNode; children: ReactNode; onReset: () => void }) {
  return (
    <section className="style-section">
      <div className="style-head">
        <h3>{title}</h3>
        <button type="button" onClick={onReset}>
          Reset to defaults
        </button>
      </div>
      <div className="style-body">
        <div className="style-fields">{children}</div>
        <div className="style-preview">{preview}</div>
      </div>
    </section>
  );
}

/**
 * Styling for one presentation. Changes apply to the preview instantly and reach the live
 * displays a moment later (the parent debounces the save); nothing here needs a Save button.
 */
export function StylePanel({ settings, videos, sampleText, onChange, onManageVideos }: Props) {
  const video = videos.find((v) => v.id === settings.main.videoId);
  // A throwaway display state, so the previews react instantly without waiting for the server.
  const sample: DisplayState = { version: 0, blank: false, lyrics: sampleText, settings, videoUrl: video?.url ?? null };

  const { videoId: _keepVideo, ...mainDefaults } = DEFAULT_SETTINGS.main; // eslint-disable-line @typescript-eslint/no-unused-vars

  return (
    <section className="editor style-panel" aria-label="Styling">
      <div className="editor-head">
        <h2>Style</h2>
        <span className="muted">Applies to this presentation. Changes show on the displays right away.</span>
      </div>

      <Section
        title="Main display (video + lyrics)"
        onReset={() => onChange({ main: mainDefaults })}
        preview={
          <figure>
            <div className="preview-box">
              <DisplayView kind="main" state={sample} preview stillVideo />
            </div>
            <figcaption>{video ? "Preview on the video's first frame" : "Preview (no video selected)"}</figcaption>
          </figure>
        }
      >
        <label className="field">
          <span>Background video</span>
          <select value={settings.main.videoId ?? ""} onChange={(e) => onChange({ main: { videoId: e.target.value ? Number(e.target.value) : null } })}>
            <option value="">None (black)</option>
            {videos.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <button type="button" className="link" onClick={onManageVideos}>
            Upload or manage videos…
          </button>
        </label>
        <StyleControls style={settings.main} onChange={(patch) => onChange({ main: patch })} />
      </Section>

      <Section
        title="Singers display (lyrics only)"
        onReset={() => onChange({ singers: DEFAULT_SETTINGS.singers })}
        preview={
          <figure>
            <div className="preview-box">
              <DisplayView kind="singers" state={sample} preview />
            </div>
            <figcaption>Preview</figcaption>
          </figure>
        }
      >
        <label className="field">
          <span>Background color</span>
          <input type="color" value={settings.singers.backgroundColor} onChange={(e) => onChange({ singers: { backgroundColor: e.target.value } })} />
        </label>
        <StyleControls style={settings.singers} onChange={(patch) => onChange({ singers: patch })} />
      </Section>
    </section>
  );
}
