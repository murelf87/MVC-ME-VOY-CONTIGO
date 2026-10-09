// Sustituto web de expo-camera (SOLO VISTA PREVIA): un navegador dentro del visor no puede abrir la cámara del móvil.
//  - Permisos: diálogo del sistema simulado del visor (cámara y micrófono).
//  - <CameraView>: visor SIMULADO y etiquetado («Cámara simulada · vista previa»). takePictureAsync() devuelve una foto de
//    ejemplo marcada como tal (shell.cameraCapture({ instant: true })): nunca se presenta como una foto real de nadie.
//  - La app nunca enciende la cámara por su cuenta: solo cuando la persona abre la pantalla de captura.
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { Text, View } from 'react-native';
import { codedError, expoPermission, permissionStatus, previewShell, requestPermission, usePermissionHook } from './_preview-system';

export const CameraType = { front: 'front', back: 'back' };
export const FlashMode = { off: 'off', on: 'on', auto: 'auto' };

export async function getCameraPermissionsAsync() {
  return expoPermission(permissionStatus('camera'));
}
export async function requestCameraPermissionsAsync() {
  return expoPermission(await requestPermission('camera'));
}
export async function getMicrophonePermissionsAsync() {
  return expoPermission(permissionStatus('microphone'));
}
export async function requestMicrophonePermissionsAsync() {
  return expoPermission(await requestPermission('microphone'));
}
export async function scanFromURLAsync() {
  return [];
}

export const Camera = { getCameraPermissionsAsync, requestCameraPermissionsAsync, getMicrophonePermissionsAsync, requestMicrophonePermissionsAsync, scanFromURLAsync };

export function useCameraPermissions() {
  return usePermissionHook('camera');
}
export function useMicrophonePermissions() {
  return usePermissionHook('microphone');
}

function simulatedPhoto(facing, options) {
  const shell = previewShell();
  if (shell && typeof shell.cameraCapture === 'function') {
    return shell.cameraCapture({ instant: true, facing, label: options && options.label }).then((f) => {
      if (!f) throw codedError('ERR_CAMERA_CANCELLED', 'La captura se ha cancelado.');
      return f;
    });
  }
  return Promise.reject(codedError('ERR_CAMERA_UNAVAILABLE', 'La cámara no está disponible en este navegador.'));
}

/** Visor simulado: fondo oscuro con la leyenda; el consumidor pinta encima su propia interfaz (guías, botón de disparo…). */
export const CameraView = forwardRef(function CameraView(props, ref) {
  const { style, children, facing = 'back', onCameraReady, onMountError } = props;
  const frozen = useRef(false);
  const readyFired = useRef(false);
  useImperativeHandle(
    ref,
    () => ({
      async takePictureAsync(options) {
        const f = await simulatedPhoto(facing, options);
        return { uri: f.uri, width: f.width || 1200, height: f.height || 1600, format: 'jpg', base64: undefined, exif: undefined };
      },
      async recordAsync() {
        throw codedError('ERR_CAMERA_VIDEO_UNAVAILABLE', 'La grabación de vídeo no está disponible en la vista previa.');
      },
      stopRecording() {},
      async pausePreview() {
        frozen.current = true;
      },
      async resumePreview() {
        frozen.current = false;
      },
      async getAvailablePictureSizesAsync() {
        return ['Photo'];
      },
      async getAvailableLensesAsync() {
        return [];
      },
      isRecording: false,
    }),
    [facing],
  );
  React.useEffect(() => {
    if (!readyFired.current) {
      readyFired.current = true;
      if (typeof onCameraReady === 'function') onCameraReady();
    }
  }, [onCameraReady, onMountError]);
  return React.createElement(
    View,
    { style: [{ backgroundColor: '#10151F', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, style], accessibilityLabel: 'Cámara simulada de la vista previa', testID: 'CameraView.simulated' },
    React.createElement(Text, { style: { color: 'rgba(255,255,255,0.72)', fontSize: 13, fontWeight: '600', textAlign: 'center', paddingHorizontal: 24 } }, 'Cámara simulada · vista previa'),
    children,
  );
});
CameraView.isAvailableAsync = async () => true;
CameraView.isModernBarcodeScannerAvailable = false;
CameraView.launchScanner = async () => undefined;
CameraView.dismissScanner = async () => undefined;
CameraView.onModernBarcodeScanned = () => ({ remove() {} });
CameraView.getAvailableVideoCodecsAsync = async () => [];

export default CameraView;
