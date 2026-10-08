/** Rounds seconds to the millisecond, far below one frame, so timing.json stays readable. */
export const toMillisecond = (seconds: number) => Math.round(seconds * 1000) / 1000;
