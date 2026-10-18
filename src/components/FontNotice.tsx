import { useI18n } from "../app/i18n";
import license from "../../third-party/fonts/MiSans.LICENSE.txt?raw";
export function FontNotice() {
  const { t } = useI18n();
  return (
    <details className="font-notice">
      <summary>{t("MiSans 字体许可")}</summary>
      <pre className="font-license">{license}</pre>
    </details>
  );
}
