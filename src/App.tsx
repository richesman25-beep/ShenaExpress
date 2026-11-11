import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { I18nProvider } from "@/i18n";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { ToastProvider } from "@/components/ui";
import { ClientLoginPage, AdminLoginPage, PasswordResetPage, PasswordSetupPage } from "@/pages/AuthPages";
import {
  ClientLayout,
  ClientDashboardPage,
  ClientOrdersPage,
  ClientOrderDetailPage,
  ClientShipmentsPage,
  ClientShipmentDetailPage,
  ClientNotificationsPage,
} from "@/pages/ClientPortal";
import { AdminLayout, AdminOverviewPage } from "@/pages/admin/AdminContext";
import { AdminClientsPage, AdminOrdersPage } from "@/pages/admin/AdminClientsAndOrders";
import {
  AdminShipmentsPage,
  AdminFinancePage,
  AdminSettingsPage,
  AdminAuditPage,
} from "@/pages/admin/AdminShipmentsFinanceSettings";

function RequireClient({ children }: { children: ReactNode }) {
  const { user, claims, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm font-semibold text-slate-600">
        Vérification de votre session…
      </div>
    );
  }
  if (!user || claims?.role !== "client") {
    return <Navigate to="/connexion" replace />;
  }
  return <>{children}</>;
}

function RequireStaff({ children }: { children: ReactNode }) {
  const { user, isBackOffice, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm font-semibold text-slate-600">
        Vérification des autorisations…
      </div>
    );
  }
  if (!user || !isBackOffice) {
    return <Navigate to="/admin/connexion" replace />;
  }
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/connexion" replace />} />
      <Route path="/connexion" element={<ClientLoginPage />} />
      <Route path="/admin/connexion" element={<AdminLoginPage />} />
      <Route path="/mot-de-passe-oublie" element={<PasswordResetPage />} />
      <Route path="/definir-mot-de-passe" element={<PasswordSetupPage />} />

      {/* Espace client */}
      <Route
        path="/espace-client"
        element={
          <RequireClient>
            <ClientLayout />
          </RequireClient>
        }
      >
        <Route index element={<ClientDashboardPage />} />
        <Route path="commandes" element={<ClientOrdersPage />} />
        <Route path="commandes/:orderId" element={<ClientOrderDetailPage />} />
        <Route path="colis" element={<ClientShipmentsPage />} />
        <Route path="colis/:shipmentId" element={<ClientShipmentDetailPage />} />
        <Route path="notifications" element={<ClientNotificationsPage />} />
      </Route>

      {/* Espace administrateur */}
      <Route
        path="/admin"
        element={
          <RequireStaff>
            <AdminLayout />
          </RequireStaff>
        }
      >
        <Route index element={<AdminOverviewPage />} />
        <Route path="clients" element={<AdminClientsPage />} />
        <Route path="commandes" element={<AdminOrdersPage />} />
        <Route path="colis" element={<AdminShipmentsPage />} />
        <Route path="finances" element={<AdminFinancePage />} />
        <Route path="parametres" element={<AdminSettingsPage />} />
        <Route path="audit" element={<AdminAuditPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/connexion" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <SettingsProvider>
        <AuthProvider>
          <ToastProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </ToastProvider>
        </AuthProvider>
      </SettingsProvider>
    </I18nProvider>
  );
}
