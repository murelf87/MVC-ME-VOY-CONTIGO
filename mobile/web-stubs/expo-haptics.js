// Sustituto web de expo-haptics (SOLO VISTA PREVIA): un navegador de escritorio no vibra. No hace nada, pero conserva
// la misma API para que la app pueda llamarla sin ramas especiales.
export const NotificationFeedbackType = { Success: 'success', Warning: 'warning', Error: 'error' };
export const ImpactFeedbackStyle = { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' };
export const AndroidHaptics = {
  Confirm: 'confirm',
  Reject: 'reject',
  Gesture_Start: 'gesture-start',
  Gesture_End: 'gesture-end',
  Toggle_On: 'toggle-on',
  Toggle_Off: 'toggle-off',
  Clock_Tick: 'clock-tick',
  Context_Click: 'context-click',
  Drag_Start: 'drag-start',
  Keyboard_Tap: 'keyboard-tap',
  Keyboard_Press: 'keyboard-press',
  Keyboard_Release: 'keyboard-release',
  Long_Press: 'long-press',
  Virtual_Key: 'virtual-key',
  Virtual_Key_Release: 'virtual-key-release',
  No_Haptics: 'no-haptics',
  Segment_Tick: 'segment-tick',
  Segment_Frequent_Tick: 'segment-frequent-tick',
  Text_Handle_Move: 'text-handle-move',
};

export async function notificationAsync() {}
export async function impactAsync() {}
export async function selectionAsync() {}
export async function performAndroidHapticsAsync() {}
