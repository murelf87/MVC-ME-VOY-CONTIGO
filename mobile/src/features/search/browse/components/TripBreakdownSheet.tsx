import React, { useState } from "react";
import { View } from "react-native";
import { describeError } from "@/api/errors";
import type { TripQuoteResponse } from "@/api/types";
import { useApiQuery } from "@/hooks";
import { BottomSheet, Button, ErrorStateCard, Skeleton } from "@/ui";
import { ContributionCard } from "../../request/components/ContributionCard";
import { InfoSheet } from "../../request/components/InfoSheet";
import { buildQuoteView } from "../../request/logic/quoteView";
import { requestStrings } from "../../request/strings";
import { quoteTrip } from "../api";
import { browseStrings } from "../strings";

const copy = browseStrings.tripDetail;

export interface TripBreakdownSheetProps {
  visible: boolean;
  tripId: string;
  dropoffStopSeq?: number;
  onClose: () => void;
}

/** «Ver desglose»: `POST /v1/trips/:tripId/quote` (sin efectos). El servidor decide cada importe. */
export function TripBreakdownSheet({ visible, tripId, dropoffStopSeq, onClose }: TripBreakdownSheetProps): React.JSX.Element {
  const [feeHelp, setFeeHelp] = useState(false);
  const query = useApiQuery<TripQuoteResponse>(
    ["trips", "breakdown", tripId, dropoffStopSeq ?? null],
    ({ signal }) => quoteTrip(tripId, dropoffStopSeq !== undefined ? { dropoffStopSeq } : {}, { signal }),
    { enabled: visible, staleTimeMs: 15_000 },
  );
  return (
    <>
      <BottomSheet visible={visible} onClose={onClose} title={copy.breakdownTitle} testID="TripDetail.breakdown" footer={<Button label={copy.breakdownClose} chevron={false} variant="outline" onPress={onClose} testID="TripDetail.breakdown.close" />}>
        <View accessibilityLiveRegion="polite">
          {query.data !== undefined ? (
            <ContributionCard view={buildQuoteView(query.data.quote, query.data.roadDistanceM)} onFeeHelp={() => setFeeHelp(true)} testID="TripDetail.breakdown.card" />
          ) : query.isError ? (
            <ErrorStateCard title={copy.breakdownFailed} message={describeError(query.error).message} actionLabel={browseStrings.common.retry} onAction={() => void query.refetch()} testID="TripDetail.breakdown.error" />
          ) : (
            <Skeleton height={160} />
          )}
        </View>
      </BottomSheet>
      <InfoSheet visible={feeHelp} title={requestStrings.review.feeHelpTitle} message={requestStrings.review.feeHelpMessage} closeLabel={requestStrings.review.feeHelpClose} onClose={() => setFeeHelp(false)} testID="TripDetail.feeHelp" />
    </>
  );
}
