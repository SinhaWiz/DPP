import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Shell } from "@/components/layout/Shell";
import { AppProviders } from "@/providers";
import { Explorer } from "@/pages/Explorer";
import { LearnPage, NotFound, Playground } from "@/pages/Pages";
import { TamperPage } from "@/pages/TamperLab";
import { StoragePage } from "@/pages/Storage";

export const AppRoutes = () => (
  <Routes>
    <Route element={<Shell />}>
      <Route index element={<Explorer />} />
      <Route path="playground" element={<Playground />} />
      <Route path="storage" element={<StoragePage />} />
      <Route path="tamper" element={<TamperPage />} />
      <Route path="learn" element={<LearnPage />} />
      <Route path="*" element={<NotFound />} />
    </Route>
  </Routes>
);

export function App() {
  return (
    <BrowserRouter>
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    </BrowserRouter>
  );
}
