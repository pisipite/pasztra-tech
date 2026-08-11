import { useState } from "react";
import type { DashboardSettings } from "../dashboardSettings";

type Props = {
  settings: DashboardSettings;
  onClose: () => void;
  onSave: (value: DashboardSettings) => void;
};

export function SettingsPanel({ settings, onClose, onSave }: Props) {
  const [draft, setDraft] = useState(settings);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <button className="icon-button settings__close" onClick={onClose} aria-label="Beállítások bezárása">×</button>
        <p className="eyebrow">Adatkapcsolat</p>
        <h2 id="settings-title">Kapcsold össze az otthonoddal</h2>
        <p className="settings__intro">A GitHub Pages nyilvános oldal. Ezért ide egy saját, biztonságos közvetítő végpont címe kerülhet — Sungrow vagy Govee API-kulcs soha.</p>
        <label className="switch-row">
          <span><strong>Élő adatok</strong><small>Demo helyett a megadott végpont használata</small></span>
          <input type="checkbox" checked={draft.live} onChange={(event) => setDraft({ ...draft, live: event.target.checked })} />
        </label>
        <label className="field">
          <span>Adatvégpont URL</span>
          <input type="url" placeholder="https://api.sajatdomain.hu/dashboard" value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} />
        </label>
        <label className="field">
          <span>Automatikus frissítés</span>
          <select value={draft.refreshSeconds} onChange={(event) => setDraft({ ...draft, refreshSeconds: Number(event.target.value) })}>
            <option value={60}>1 percenként</option>
            <option value={300}>5 percenként</option>
            <option value={900}>15 percenként</option>
          </select>
        </label>
        <button className="primary-button" onClick={() => onSave(draft)}>Beállítások mentése</button>
      </section>
    </div>
  );
}
