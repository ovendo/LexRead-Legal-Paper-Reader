import { DashboardPage } from "./pages/DashboardPage";
import { JudgmentReaderPage } from "./pages/JudgmentReaderPage";
import { MaterialsPage } from "./pages/MaterialsPage";
import { CitationPage } from "./pages/CitationPage";
import { PaperReaderPage } from "./pages/PaperReaderPage";
import { PaperOverviewPage } from "./pages/PaperOverviewPage";
import { ProjectPage } from "./pages/ProjectPage";
import { UploadPage } from "./pages/UploadPage";
import { WritingPage } from "./pages/WritingPage";
import { RouterProvider, useRouter } from "./router";

function Routes() {
  const { path } = useRouter();
  if (path.includes("upload-parse")) return <UploadPage />;
  if (path.includes("/projects/") && path.includes("/writing")) return <WritingPage />;
  if (path.includes("/projects/") && path.includes("/matrix")) return <CitationPage />;
  if (path.includes("/projects/") && path.includes("/materials")) return <MaterialsPage />;
  if (path.includes("/projects/")) return <ProjectPage />;
  if (path.includes("/papers/")) return <PaperOverviewPage />;
  if (path.includes("/read/paper/")) return <PaperReaderPage />;
  if (path.includes("/read/judgment/")) return <JudgmentReaderPage />;
  return <DashboardPage />;
}

export function App() {
  return <RouterProvider><Routes /></RouterProvider>;
}
