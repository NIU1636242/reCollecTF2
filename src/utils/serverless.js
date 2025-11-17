// src/utils/serverless.js
const dispatchUrl = "https://recollectf.vercel.app/api/functions/send-form.ts";

export async function dispatchWorkflow(data) {

    console.log("Data to dispatch:", data);
    
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