
const dispatchUrl = "https://collectf.vercel.app/api/auth/functions/send-form.ts"//DEV: "http://localhost:3000/api/auth/functions/send-form.ts";

export async function dispatchWorkflow(data) {
  const res = await fetch(dispatchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(data),
  });

  return await res;
}