import { Navigate } from 'react-router-dom';

function ProtectedRoute({ userStatus, children}) {

    if (userStatus !== 2) {        
        return <Navigate to={'/'} replace />;
    }

    return children;
}

export default ProtectedRoute;