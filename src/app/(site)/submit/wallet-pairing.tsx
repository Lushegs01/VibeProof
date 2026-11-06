"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { pairingSnapshot, serverPairingSnapshot, subscribePairing } from "@/lib/wallet/walletconnect";

export function WalletPairing() {
  const pairing = useSyncExternalStore(subscribePairing, pairingSnapshot, serverPairingSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const [qr, setQr] = useState<{ uri: string; image: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!pairing) {
      dialog.current?.close();
      return;
    }
    if (!dialog.current?.open) dialog.current?.showModal();
    let active = true;
    setError("");
    import("qrcode")
      .then((qrcode) => qrcode.toDataURL(pairing.uri, { width: 280, margin: 2, errorCorrectionLevel: "M" }))
      .then((image) => {
        if (active) setQr({ uri: pairing.uri, image });
      })
      .catch(() => {
        if (active) setError("Could not render the wallet pairing code. Cancel and retry.");
      });
    return () => {
      active = false;
    };
  }, [pairing]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="wallet-pairing-title"
      onCancel={(event) => {
        event.preventDefault();
        pairing?.cancel();
      }}
      className="max-w-sm rounded-2xl border border-line bg-surface p-6 text-fg backdrop:bg-black/70"
    >
      <h2 id="wallet-pairing-title" className="text-xl">
        Connect your wallet
      </h2>
      <p className="my-3 text-sm text-fg-2">Scan this code with your wallet’s WalletConnect scanner. Pairing does not authorize a transaction.</p>
      {pairing && qr?.uri === pairing.uri ? (
        <img src={qr.image} alt="WalletConnect pairing QR code" width={280} height={280} className="mx-auto rounded-lg" />
      ) : (
        <p role="status">{error || "Preparing QR code…"}</p>
      )}
      <button type="button" onClick={() => pairing?.cancel()} className="btn btn-outline mt-4 w-full">
        Cancel pairing
      </button>
    </dialog>
  );
}
