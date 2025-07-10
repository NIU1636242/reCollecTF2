import { useEffect, useState } from 'react';

const vercelUrl = 'https://recollectf.vercel.app' // to be changed in dev 'http://localhost:3000'

export function useSession() {
  const [user, setUser] = useState(null);
  const [userStatus, setUserStatus] = useState(0); // 0: logged out, 1: logged in, 2: logged in and collaborator
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getUser = async () => {
      try {
        const userRes = await fetch(`${vercelUrl}/api/functions/get-user`, { credentials: 'include' });
        if (!userRes.ok) throw new Error('Not logged in')
        const userData = await userRes.json()
        setUser(userData.username)

        const collabRes = await fetch(`${vercelUrl}/api/functions/check-collaborator`, { credentials: 'include' });
        if (!collabRes.ok) throw new Error('Not logged in')
        const collabData = await collabRes.json()
        setUserStatus(collabData.isCollaborator ? 2 : 1)
      }
      catch {
        setUser(null)
        setUserStatus(0)
      }
      finally {
        setLoading(false)
      }
    }

    getUser()

  },[])

  return { user, userStatus, loading };
}