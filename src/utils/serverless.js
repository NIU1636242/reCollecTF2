
// src/utils/serverless.js
const dispatchUrl = "https://re-collec-tf-2.vercel.app/api/functions/send-form.ts";

export async function dispatchWorkflow(payload) {
  const res = await fetch(dispatchUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Error from Vercel: ${text}`);
  }
  return res.json().catch(() => ({}));
}
