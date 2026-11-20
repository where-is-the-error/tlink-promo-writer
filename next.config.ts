import type { NextConfig } from "next";

const config: NextConfig = {
  // pdfjs-dist는 번들하지 않고 Node에서 그대로 불러온다(워커 파일 경로 문제 방지).
  serverExternalPackages: ["pdfjs-dist"],
};

export default config;
