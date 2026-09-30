/** Demo mode serves a deterministic, clearly-labelled dataset and NEVER touches testnet data. */
export const isDemoMode = () => process.env.NEXT_PUBLIC_DEMO_MODE === "true";
