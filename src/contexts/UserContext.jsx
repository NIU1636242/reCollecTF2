import { createContext, useContext } from 'react';
import {useSession} from "@/hooks/useSession";

const UserContext = createContext();

export function UserProvider({ children }) {

    const { user, userStatus, loading } = useSession();

    return (
        <UserContext.Provider value={{ user, userStatus, loading }}>
            {children} 
        </UserContext.Provider>
    );
}

export const useUser = () => {  return useContext(UserContext) }
