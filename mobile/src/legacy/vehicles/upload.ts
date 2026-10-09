import * as ImagePicker from "expo-image-picker";
import { apiRequest, ApiError } from "../../api/client";
import type {
  CompletePrivateUpload,
  PrivateUploadIntent,
} from "../../api/types";

export type VehicleUploadKind = "vehicle_photo" | "vehicle_insurance";

export type SelectedVehicleImage = {
  uri: string;
  contentType: string;
  sizeBytes: number;
  fileName: string;
};

function extensionFromMime(type: string): string {
  switch (type) {
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/heic": return "heic";
    case "image/heif": return "heif";
    default: return "jpg";
  }
}

async function assetToSelected(
  asset: ImagePicker.ImagePickerAsset,
  fallbackPrefix: string
): Promise<SelectedVehicleImage> {
  const response = await fetch(asset.uri);
  const blob = await response.blob();
  const contentType =
    asset.mimeType ||
    blob.type ||
    (asset.uri.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
  const sizeBytes = asset.fileSize ?? blob.size;

  if (!Number.isFinite(sizeBytes) || sizeBytes < 1) {
    throw new ApiError(
      "No se pudo calcular el tamaño de la foto.",
      "LOCAL_FILE_SIZE_UNKNOWN",
      0
    );
  }

  if (sizeBytes > 20 * 1024 * 1024) {
    throw new ApiError(
      "La imagen supera el límite de 20 MB.",
      "LOCAL_FILE_TOO_LARGE",
      0
    );
  }

  return {
    uri: asset.uri,
    contentType,
    sizeBytes,
    fileName:
      asset.fileName ||
      `${fallbackPrefix}.${extensionFromMime(contentType)}`,
  };
}

export async function pickVehicleImage(
  source: "camera" | "library",
  fallbackPrefix: string
): Promise<SelectedVehicleImage | null> {
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new ApiError(
        "Necesitamos permiso de cámara para hacer la foto.",
        "CAMERA_PERMISSION_REQUIRED",
        0
      );
    }
  } else {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new ApiError(
        "Necesitamos permiso para elegir una foto.",
        "PHOTO_LIBRARY_PERMISSION_REQUIRED",
        0
      );
    }
  }

  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          allowsEditing: false,
          quality: 0.9,
          exif: false,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: false,
          quality: 0.9,
          exif: false,
          selectionLimit: 1,
        });

  if (result.canceled || !result.assets[0]) return null;
  return assetToSelected(result.assets[0], fallbackPrefix);
}

export async function uploadVehicleImage(
  token: string,
  vehicleId: string,
  kind: VehicleUploadKind,
  selected: SelectedVehicleImage
): Promise<CompletePrivateUpload> {
  const intent = await apiRequest<PrivateUploadIntent>(
    "/v1/me/uploads/intents",
    {
      method: "POST",
      token,
      body: {
        kind,
        vehicleId,
        contentType: selected.contentType,
        sizeBytes: selected.sizeBytes,
      },
    }
  );

  const local = await fetch(selected.uri);
  const blob = await local.blob();

  const uploadResponse = await fetch(intent.uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": selected.contentType,
      ...intent.headers,
    },
    body: blob,
  });

  if (!uploadResponse.ok) {
    throw new ApiError(
      "No se pudo subir el archivo al almacenamiento privado.",
      "PRIVATE_UPLOAD_FAILED",
      uploadResponse.status
    );
  }

  return apiRequest<CompletePrivateUpload>(
    `/v1/me/uploads/${intent.intentId}/complete`,
    {
      method: "POST",
      token,
    }
  );
}
