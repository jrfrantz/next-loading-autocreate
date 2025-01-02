import { parse } from "@babel/parser";
import traverse from "@babel/traverse"
import OpenAI from "openai";
import fs = require("fs");
import path from "path";
import { startComment } from "./consts";
import { glob } from "glob";
import { prompt } from "./prompt";


export async function generateLoadingFile(fullPath: string) {
  const relativePath = path.relative(process.cwd(), fullPath)
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })
  // read file to string
  const fileContent = fs.readFileSync(fullPath, 'utf8');

  // go up the file tree, up to the root of the project, and find layout.tsx files
  const layoutFiles = []
  let currentPath = path.dirname(fullPath)
  while (currentPath !== process.cwd()) {
    const layoutFile = path.join(currentPath, "layout.tsx")
    if (fs.existsSync(layoutFile)) {
      layoutFiles.push(layoutFile)
      break; // only take the first one
    }
    currentPath = path.dirname(currentPath)
  }
  const layoutFileContents = layoutFiles.map(layoutFile => fs.readFileSync(layoutFile, 'utf8'))

  const cssFiles = []
  const pattern = '**/app/**/*.*css'
  const foundCssFiles = glob.sync(pattern, { 
    cwd: process.cwd(),
    dot: true,
    nodir: true,
    ignore: [
      '**/.next/**',
      '**/node_modules/**',
    ]
  })
  cssFiles.push(...foundCssFiles)
  const cssFileContents = cssFiles.map(cssFile => fs.readFileSync(cssFile, 'utf8'))
  // console.log({ cssFileContents })
  const tailwindPattern = 'tailwind.config.{js,ts}'
  const tailwindFile = glob.sync(tailwindPattern, { 
    cwd: process.cwd(),
    dot: true,
    nodir: true,
    ignore: [
      '**/.next/**',
      '**/node_modules/**',
    ]
  })
  const tailwindFileContents = tailwindFile[0] ? fs.readFileSync(tailwindFile[0], 'utf8') : ""
  // console.log({ tailwindFileContents })
  // parse file into an AST so you can check for local imports
  const ast = parse(fileContent, {
    sourceType: "module",
    plugins: ["typescript", "jsx" ],
  });
  const localImports: string[] = [];
  // check if the default export is an async function
  traverse(ast, {
    ExportDefaultDeclaration(path) {
      const declaration = path.node.declaration;
      if (declaration.type === "FunctionDeclaration") {
        const isAsync = declaration.async;
      }
    },
    ImportDeclaration(path) {
      const source = path.node.source.value;
      //console.log({ source })
      // check if the import is a local import
      // of a react component
      localImports.push(source);
    },
  });


  // read prompt.txt into a string variable at build time, noting that 
  // this will be run in OTHER PEOPLES DIRECTORIES
  // ask the AI to generate a loading screen based on 
  // the file content
  console.log(`${relativePath}: Creating loading screen`)
  const response = await openai.chat.completions.create({
    model: 'chatgpt-4o-latest',
    messages: [
      { 
        role: "system", 
        content: prompt,
      },
      { 
        role: "user", 
        content: `
        <page.tsx>
        ${fileContent}
        </page.tsx>

        <layout.tsx>
        ${layoutFileContents.join("\n\n")}
        </layout.tsx>

        <css>
        ${cssFileContents.join("\n\n")}
        </css>

        <tailwind.config.ts>
        ${tailwindFileContents}
        </tailwind.config.ts>
        `},
    ],
  })


  const fileOutputAi = response.choices[0]?.message.content ?? ""
  const fileOutput = fileOutputAi.replace(/```tsx/g, "").replace(/```/g, "")

  // TODO ensure it is valid react code and retry or bail otherwise

  const prefix = startComment+
`// This file will stay up-to-date when you make changes to your \`page.tsx\` file
// and run \`generate-next-loading\` again.
// You can edit this file. To prevent future overwrites, delete the comment line.
`

  // write it to the corresponding loading.tsx in the same directory as page.tsx
  // use the same file suffix as the page.(tsx | jsx | ts | js)
  const loadingFileLocation = path.join(path.dirname(fullPath), "loading"+path.extname(fullPath))
  const relativeLoadingLocation = path.relative(process.cwd(), loadingFileLocation)
  
  fs.writeFileSync(loadingFileLocation, prefix + fileOutput)
  console.log(`${relativePath}: Wrote loading screen to ${relativeLoadingLocation}`)
}