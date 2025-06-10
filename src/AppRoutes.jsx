import { HashRouter, Routes, Route } from "react-router-dom";
import Layout from "./pages/Layout";
import HomePage from "./pages/HomePage";
import SearchPage from "./pages/Search/SearchPage";
import WritePage from "./pages/WritePage";
import ProtectedRoute from "./components/ProtectedRoute";
import { useUser } from "./components/contexts/UserContext";

function AppRoutes() {
  const { userStatus } = useUser();

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="Search/:step?" element={<SearchPage />}>
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
    </HashRouter>
  );
}

export default AppRoutes;