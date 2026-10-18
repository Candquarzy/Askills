import { useI18n } from "../app/i18n";
import license from "../../third-party/fonts/MiSans.LICENSE.txt?raw";
export function FontNotice() {
  const { t } = useI18n();
  return (
    <section className="settings-section">
      <h2>{t("界面字体")}</h2>
      <p>
        {t(
          "本应用使用 MiSans 字体，由小米提供。原版字体随应用内置，离线可用。",
        )}
      </p>
      <details>
        <summary>{t("MiSans 字体许可")}</summary>
        <pre className="font-license">{license}</pre>
      </details>
    </section>
  );
}
