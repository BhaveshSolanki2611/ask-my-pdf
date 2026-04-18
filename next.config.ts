import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  serverExternalPackages: ["@llamaindex/llama-cloud"],
};

export default withWorkflow(nextConfig);
