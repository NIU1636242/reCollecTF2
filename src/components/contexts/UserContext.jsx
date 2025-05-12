import { createContext, useContext } from 'react';
import {useSession} from "../../hooks/useSession";

const UserContext = createContext();

export function UserProvider({ children }) {

    const { user, userStatus, loading } = useSession();

    return (
        <UserContext.Provider value={{ user, userStatus, loading }}>
            {children} {/*Everything inside this component can access to the value. (We will wrap our App inside this component)*/}
        </UserContext.Provider>
    );
}

export const useUser = () => {  return useContext(UserContext) }

