// Scheduled windows, not a holiday/halt calendar or venue eligibility check.
export function krSession(now) {
  const d=new Date(now+9*3600000),day=d.getUTCDay();
  const minute=d.getUTCHours()*60+d.getUTCMinutes();
  if(day===0||day===6) return 'closed';
  if(minute>=480&&minute<530) return 'nxt-pre';
  if(minute>=540&&minute<930) return 'krx-regular';
  if(minute>=940&&minute<1200) return 'nxt-after';
  return 'closed';
}
export function krRegularBar(at) {
  return krSession(at)==='krx-regular' && krSession(at+299999)==='krx-regular';
}
export function krSettlement(now) {
  const d=new Date(now+9*3600000),m=d.getUTCHours()*60+d.getUTCMinutes();
  return d.getUTCDay()>=1&&d.getUTCDay()<=5&&m>=930&&m<950;
}
