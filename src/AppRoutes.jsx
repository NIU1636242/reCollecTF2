import { BrowserRouter, Routes, Route } from "react-router-dom";
import ReactDOM from "react-dom/client";
import Layout from "./pages/Layout";
import HomePage from "./pages/HomePage";
import SearchPage from "./pages/SearchPage";
import WritePage from "./pages/WritePage";
import SearchTF from "./pages/SearchTF";
import SearchSpecies from "./pages/SearchSpecies";
import SearchExpTechniques from "./pages/SearchExpTechniques";
import { UserProvider } from './components/contexts/UserContext';
import ProtectedRoute from "./components/ProtectedRoute";
import { useUser } from "./components/contexts/UserContext";

function AppRoutes() {
  const { userStatus } = useUser();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/CollecTF" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="Search" element={<SearchPage />}>
            <Route path="1" element={<SearchTF />} />
            <Route path="2" element={<SearchSpecies />} />
            <Route path="3" element={<SearchExpTechniques />} />
          </Route>
          <Route
            path="Write"
            element={
              <ProtectedRoute userStatus={userStatus}>
                <WritePage />
              </ProtectedRoute>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default AppRoutes;
