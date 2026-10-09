/**
 * Kit de interfaz de MVC · Me voy contigo (`import { Button, Screen … } from "@/ui"`).
 * Componentes puramente presentacionales: sin red, sin navegación (salvo `ScreenHeader`, que usa el `goBack` del contexto
 * si existe). Todos aceptan `testID` y exponen roles/etiquetas accesibles.
 */
export { Text } from "./Text";
export type { TextProps } from "./Text";

export { Screen } from "./Screen";
export type { ScreenProps } from "./Screen";
export { ScreenHeader } from "./ScreenHeader";
export type { ScreenHeaderProps, ScreenHeaderRightAction, ScreenHeaderRightAvatar } from "./ScreenHeader";

export { Button } from "./Button";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./Button";
export { LargeButton, LARGE_BUTTON_HEIGHT } from "./LargeButton";
export type { LargeButtonProps } from "./LargeButton";
export { IconButton } from "./IconButton";
export type { IconButtonProps, IconButtonVariant } from "./IconButton";

export { Card, TintCard } from "./Card";
export type { CardProps } from "./Card";
export { surfaces } from "./tones";
export type { SurfaceColors, SurfaceTone } from "./tones";
export { Divider, SectionHeader, KeyValueRow, ListRow } from "./Rows";
export type { DividerProps, SectionHeaderProps, KeyValueRowProps, ListRowProps } from "./Rows";
export { StatTile } from "./StatTile";
export type { StatTileProps } from "./StatTile";

export { TextField, TextArea, SelectField, PhoneField, formatPhoneInput } from "./TextField";
export type { FieldVariant, TextFieldProps, TextAreaProps, SelectFieldProps, PhoneFieldProps } from "./TextField";
export { OtpInput, PickupCode } from "./OtpInput";
export type { OtpInputProps, PickupCodeProps } from "./OtpInput";
export { Checkbox, Radio, RadioRow, Switch } from "./Controls";
export type { CheckboxProps, RadioProps, RadioRowProps, SwitchProps } from "./Controls";
export { Segmented } from "./Segmented";
export type { SegmentedOption, SegmentedProps, SegmentedVariant } from "./Segmented";
export { DayPills } from "./DayPills";
export type { DayPillsProps } from "./DayPills";
export { CategoryChips, tripCategoryIcon, tripCategoryOrder } from "./CategoryChips";
export type { CategoryChipsProps } from "./CategoryChips";

export { StatusPill } from "./StatusPill";
export type { StatusPillProps, StatusTone } from "./StatusPill";
export { Banner } from "./Banner";
export type { BannerKind, BannerProps } from "./Banner";
export { ErrorStateCard } from "./ErrorStateCard";
export type { ErrorStateCardProps, ErrorStateKind } from "./ErrorStateCard";
export { OfflineBanner } from "./OfflineBanner";
export type { OfflineBannerProps } from "./OfflineBanner";
export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";
export { StepProgress } from "./StepProgress";
export type { StepProgressProps, StepState } from "./StepProgress";
export { NumberedList } from "./NumberedList";
export type { NumberedListProps } from "./NumberedList";
export { CountBadge } from "./Badge";
export type { CountBadgeProps, CountBadgeTone } from "./Badge";

export { Avatar } from "./Avatar";
export type { AvatarProps } from "./Avatar";
export { RatingStars, RatingBadge } from "./Rating";
export type { RatingStarsProps, RatingBadgeProps } from "./Rating";
export { RouteTimeline } from "./RouteTimeline";
export type { RouteStop, RouteStopState, RouteTimelineProps } from "./RouteTimeline";
export { MapCard } from "./MapCard";
export type { MapCardProps, MapCardStatus } from "./MapCard";

export { BottomNav } from "./BottomNav";
export type { BottomNavKey, BottomNavProps } from "./BottomNav";

export { Skeleton, SkeletonText, SkeletonList, Spinner, LoadingBlock } from "./Skeleton";
export type { SkeletonProps, SkeletonTextProps, SkeletonListProps, SpinnerProps, LoadingBlockProps } from "./Skeleton";
export { ToastHost, showToast, hideToast } from "./Toast";
export type { ToastHostProps, ToastKind, ToastOptions } from "./Toast";
export { BottomSheet, Dialog, ConfirmDialog, OptionSheet } from "./Sheets";
export type { BottomSheetProps, DialogProps, ConfirmDialogProps, OptionSheetOption, OptionSheetProps } from "./Sheets";
export { PermissionExplainer } from "./PermissionExplainer";
export type { PermissionExplainerProps, PermissionKind, PermissionStatus } from "./PermissionExplainer";

export { ChatBubble, ChatLocationCard, MessageComposer } from "./Chat";
export type { ChatBubbleProps, ChatLocationCardProps, MessageComposerProps, MessageDeliveryStatus } from "./Chat";

export { useReducedMotion } from "./useReducedMotion";
