import { UserProvider } from '@/contexts/UserContext';
import AppRoutes from './AppRoutes';

function App() {

  return (
    <UserProvider>
      <AppRoutes />
    </UserProvider>
  )
}

export default App;