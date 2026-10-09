import React from "react";
import { Banner, type BannerKind } from "@/ui";
import { openAppSettings } from "@/platform";
import { publishStrings } from "../strings";
import type { UploadNotice } from "../hooks/useUploadFlow";

const KIND: Record<UploadNotice["tone"], BannerKind> = { success: "success", error: "error", warning: "warning" };

export interface NoticeBannerProps {
  notice: UploadNotice;
  testID: string;
}

/** Aviso del resultado de una subida (permiso denegado, formato, tamaño, enviada…). Con permisos bloqueados ofrece «Abrir ajustes». */
export function NoticeBanner({ notice, testID }: NoticeBannerProps): React.JSX.Element {
  return (
    <Banner
      testID={testID}
      kind={KIND[notice.tone]}
      size="sm"
      message={notice.message}
      {...(notice.settings ? { actionLabel: publishStrings.common.openSettings, onAction: () => void openAppSettings() } : {})}
    />
  );
}
