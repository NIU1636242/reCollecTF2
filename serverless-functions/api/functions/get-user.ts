import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parse } from 'cookie';
import jwt from 'jsonwebtoken';

export default function handler(req: VercelRequest, res: VercelResponse) {

    //1 - Allow CORS
    const origin = "https://milegoo.github.io/CollecTF/" //change in dev

    res.setHeader("Access-Control-Allow-Origin", origin); // to be changed in prod
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
    if (req.method === "OPTIONS") {
      return res.status(200).end(); // CORS preflight
    }

    //2 - Verify JWT token from cookies and return
    const cookies = parse(req.headers.cookie || '');
    const token = cookies.session_token;

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    type MyTokenPayload = {
        username: string;
        accessToken: string;
        iat?: number;
        exp?: number;
    };

    try {
        const { username } = jwt.verify(token, process.env.JWT_SECRET!) as MyTokenPayload;
        return res.status(200).json({ username });
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
  }
}
