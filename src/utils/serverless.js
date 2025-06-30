
const dispatchUrl = "https://collectf.vercel.app/api/functions/send-form.ts" // "https://collectf.vercel.app/api/functions/send-form.ts"; "http://localhost:3000/api/auth/functions/send-form.ts"

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