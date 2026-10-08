import { DomainError } from "../errors.js";

/**
 * A refund rule in basis points (10000 = 100 %), applied separately to the
 * trip contribution and to the passenger commission so MVC can keep its fee
 * in some cases without that being a fixed rule. No figures live in code:
 * every number comes from an approved, versioned policy.
 */
export type RefundRule={refundContributionBps:number;refundPassengerFeeBps:number};
export type PassengerTier=RefundRule&{minMinutesBeforeDeparture:number};
export type CancellationRules={
  passenger:PassengerTier[];
  passengerAfterStart:RefundRule;
  driver:RefundRule;
  platform:RefundRule;
  forceMajeure:RefundRule;
};

function bps(v:unknown,path:string):number{
  if(!Number.isInteger(v)||(v as number)<0||(v as number)>10000){
    throw new DomainError("INVALID_POLICY_RULES",`${path} must be an integer between 0 and 10000`);
  }
  return v as number;
}
function rule(v:any,path:string):RefundRule{
  if(!v||typeof v!=="object") throw new DomainError("INVALID_POLICY_RULES",`${path} is required`);
  return {
    refundContributionBps:bps(v.refundContributionBps,`${path}.refundContributionBps`),
    refundPassengerFeeBps:bps(v.refundPassengerFeeBps,`${path}.refundPassengerFeeBps`)
  };
}

export function parseCancellationRules(raw:any):CancellationRules{
  if(!raw||typeof raw!=="object") throw new DomainError("INVALID_POLICY_RULES","Rules must be an object");
  if(!Array.isArray(raw.passenger)||raw.passenger.length<1||raw.passenger.length>10){
    throw new DomainError("INVALID_POLICY_RULES","passenger must list 1 to 10 tiers");
  }
  const passenger=raw.passenger.map((t:any,i:number)=>{
    if(!Number.isInteger(t?.minMinutesBeforeDeparture)||t.minMinutesBeforeDeparture<0){
      throw new DomainError("INVALID_POLICY_RULES",`passenger[${i}].minMinutesBeforeDeparture must be a non-negative integer`);
    }
    return {minMinutesBeforeDeparture:t.minMinutesBeforeDeparture,...rule(t,`passenger[${i}]`)};
  }).sort((a:PassengerTier,b:PassengerTier)=>b.minMinutesBeforeDeparture-a.minMinutesBeforeDeparture);
  if(passenger[passenger.length-1].minMinutesBeforeDeparture!==0){
    throw new DomainError("INVALID_POLICY_RULES","passenger tiers must include one with minMinutesBeforeDeparture 0");
  }
  return {
    passenger,
    passengerAfterStart:rule(raw.passengerAfterStart,"passengerAfterStart"),
    driver:rule(raw.driver,"driver"),
    platform:rule(raw.platform,"platform"),
    forceMajeure:rule(raw.forceMajeure,"forceMajeure")
  };
}

/** Round half up to the cent; documented in docs/CANCELLATIONS.md. */
function share(cents:number,bp:number):number{
  return Math.floor((cents*bp+5000)/10000);
}

export function computeRefund(
  rules:CancellationRules,
  input:{
    actor:"passenger"|"driver"|"platform"|"force_majeure";
    tripStarted:boolean;
    minutesBeforeDeparture:number|null;
    paidCents:number;
    passengerFeeCents:number;
  }
):{ruleApplied:string;refundCents:number;retainedCents:number;refundContributionCents:number;refundFeeCents:number}{
  let applied:RefundRule;let name:string;
  if(input.actor==="driver"){applied=rules.driver;name="driver";}
  else if(input.actor==="platform"){applied=rules.platform;name="platform";}
  else if(input.actor==="force_majeure"){applied=rules.forceMajeure;name="forceMajeure";}
  else if(input.tripStarted){applied=rules.passengerAfterStart;name="passengerAfterStart";}
  else{
    const minutes=Math.max(0,input.minutesBeforeDeparture??0);
    const idx=rules.passenger.findIndex(t=>minutes>=t.minMinutesBeforeDeparture);
    applied=rules.passenger[idx] as PassengerTier;name=`passenger[${idx}]`;
  }
  const fee=Math.min(Math.max(0,input.passengerFeeCents),input.paidCents);
  const contribution=input.paidCents-fee;
  const refundContributionCents=share(contribution,applied.refundContributionBps);
  const refundFeeCents=share(fee,applied.refundPassengerFeeBps);
  const refundCents=refundContributionCents+refundFeeCents;
  return {ruleApplied:name,refundCents,retainedCents:input.paidCents-refundCents,refundContributionCents,refundFeeCents};
}
