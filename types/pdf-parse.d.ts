declare module "pdf-parse" {
  type TextItem = {
    str: string;
    transform: number[];
  };

  type TextContent = {
    items: TextItem[];
  };

  type PageData = {
    getTextContent: (options: {
      normalizeWhitespace: boolean;
      disableCombineTextItems: boolean;
    }) => Promise<TextContent>;
  };

  type ParseOptions = {
    pagerender?: (pageData: PageData) => Promise<string>;
  };

  type ParseResult = {
    numpages?: number;
    numrender?: number;
    info?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    version?: string;
    text?: string;
  };

  export default function pdfParse(
    dataBuffer: Buffer,
    options?: ParseOptions,
  ): Promise<ParseResult>;
}
