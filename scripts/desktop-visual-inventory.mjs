// Rebuild the desktop source inventory after UI edits. No runtime claim is inferred.
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(path.join(p,d.name)):[path.join(p,d.name)]);
const files=walk('src').filter(p=>p.endsWith('.tsx')&&!p.startsWith('src/mobile/')&&!p.includes('.test.')).sort();
const rows=[];
function hasJsx(node) { return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node) || Boolean(ts.forEachChild(node, child => hasJsx(child) || undefined)); }
const groups={
 settings:['Claude final-comparison Settings metrics; design-tokens/menu-metrics; Monocode settings content','Centered 1024×800 dialog, 192px nav, uncarded rows and shared controls; retain real settings actions'],
 bots:['Monocode adaptation of shared Claude desktop palette, fonts and controls','Scoped desktop Bots surfaces adopt shared semantics; existing contacts, messages, management geometry and state remain Monocode behavior'],
 sessions:['Claude new/chat/Code layout and typography; Monocode provider behavior','Chat composer640/radius14/input15/21; Code header32/prose14/20; retain tools, approval, attachments, provider and virtual scrolling behavior'],
 workflows:['Claude shared menu/control metrics; repository Motion rules','Shared kit controls and owned chrome; retain graph geometry and business behavior; selected labels survive menu closing'],
 'source-control':['Claude shared desktop palette and controls; Monocode professional workspace adaptation','Owned chrome, dialogs and fields; retain diff/graph content, editor themes and virtual measurements'],
 files:['Claude shared desktop palette and controls; Monocode file workspace adaptation','Owned toolbar and fields; preserve editor, search, tree, navigation and content measurements'],
 terminal:['Claude compact panel chrome; Monocode terminal adaptation','Owned dock chrome; retain xterm sizing, mounted PTY and direct resizing behavior'],
 shell:['Claude final-comparison sidebar/new and layout metrics; Monocode navigation','Sidebar288/header44/rows32/mode70×28; preserve project, provider, archived-session and native window control semantics'],
 shared:['Claude design-tokens/menu-metrics; repository Motion/collapse contracts','Shared semantic palette, local fonts, controls and portal lifecycle; retain public props, focus and accessibility contracts'],
};
const resolve=(from,spec)=>{
 if(!spec.startsWith('.'))return null;
 const base=path.resolve(path.dirname(from),spec).replace(/\.js$/,'');
 for(const suffix of ['', '.tsx','.ts','/index.tsx','/index.ts']){const rel=path.relative('.',base+suffix);if(fs.existsSync(rel))return rel;}
 return null;
};
for(const file of files){
 const source=fs.readFileSync(file,'utf8'), ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const imports=[],components=[],hooks=new Set();let jsx=0;
 const visit=n=>{
  if(ts.isImportDeclaration(n)&&ts.isStringLiteral(n.moduleSpecifier)){const target=resolve(file,n.moduleSpecifier.text);if(target)imports.push(target);}
  if((ts.isFunctionDeclaration(n)||ts.isVariableDeclaration(n)||ts.isClassDeclaration(n))&&n.name&&/^[A-Z]/.test(n.name.getText(ast))){
   const body=ts.isFunctionDeclaration(n)?n.body:ts.isVariableDeclaration(n)?n.initializer:n;
   if(body&&hasJsx(body))components.push(n.name.getText(ast));
  }
  if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n))jsx++;
  if(ts.isJsxAttribute(n)&&n.name.getText(ast)==='className'&&n.initializer){for(const m of n.initializer.getText(ast).matchAll(/\b(?:desktop-[\w-]+|settings-row[\w-]*)/g))hooks.add(m[0]);}
  ts.forEachChild(n,visit);
 };visit(ast);
 const group=file.startsWith('src/features/connections/files/')?'files':file.startsWith('src/features/')?file.split('/')[2]:file.startsWith('src/app/')?'shell':file.startsWith('src/shared/')?'shared':'entry';
 const [evidence,target]=groups[group]??['Claude shared desktop design tokens; Monocode domain adaptation','Shared semantic palette, controls and owned chrome; unmatched domain geometry and business states retained'];
 rows.push({id:file.replace(/^src\//,'').replace(/\.tsx$/,''),file,components:[...new Set(components)],group,jsxElements:jsx,hooks:[...hooks].sort(),imports,styleSources:[...(jsx?['src/styles/desktop-tokens.css','src/shared/styles/fonts.css','src/shared/styles/typography.css','src/styles/desktop-controls.css','src/styles/desktop-workspaces.css','src/styles/desktop-sidebar.css','src/styles/desktop-navigation.css','src/styles/desktop-conversation.css','src/styles/desktop-theme.css','src/styles/controls/forms.css','src/styles/controls/messaging.css','src/styles/desktop-messaging.css']:[]),...imports.filter(p=>p.endsWith('.css'))],evidence:jsx?evidence:'not visual',mapping:jsx?'Monocode adaptation of measured Claude geometry and shared semantics; file-level applicability is not runtime coverage':'nonvisual provider/context',target:jsx?target:'No visual change',geometry:'Preserve unless explicitly mapped in docs/desktop-visual-spec.md',themes:'light and dark: Claude measured semantic palette; user font/scale preferences retain precedence',motion:'Repository easing and180/200/240ms timings; AutoAnimate lists; shared bidirectional collapse; reduced-motion and hidden portal rules',runtime:'Not individually runtime-tested; see delivery matrix',sha256:crypto.createHash('sha256').update(source).digest('hex')});
}
// Record direct/transitive use of the migrated component implementations.
const migrated=new Set(rows.filter(r=>r.hooks.length||/shared\/ui\/(forms\/|Popover|Modal|SearchableSelect)|shared\/ui\/primitives\//.test(r.file)).map(r=>r.file));
let added=true;while(added){added=false;for(const r of rows)if(!migrated.has(r.file)&&r.imports.some(i=>migrated.has(i))){migrated.add(r.file);added=true;}}
for(const row of rows)row.integration=!row.jsxElements?'nonvisual':row.hooks.length?'explicit component hooks':migrated.has(row.file)?'shared component adapter':'semantic palette; local geometry retained';
const json=JSON.stringify({version:2,evidence:'Claude UI analysis final measured geometry, 2026-10-12; Monocode adaptations, 2026-10-13',reference:'/home/wy/projects/claude-ui-analysis/final-comparison.md',boundary:'Static source inventory, including lazy components. Declarations can include JSX constants; imports and hooks do not establish reachability, measurement or runtime validation of every component.',sourceFiles:rows.length,componentDeclarations:rows.reduce((n,r)=>n+r.components.length,0),rows},null,2)+'\n';
const fields=['id','file','components','group','integration','evidence','mapping','target','geometry','themes','motion','runtime','hooks','styleSources'];
const quote=v=>'"'+String(Array.isArray(v)?v.join(' | '):v).replaceAll('"','""')+'"';
const csv=[fields.join(','),...rows.map(r=>fields.map(k=>quote(r[k])).join(','))].join('\n')+'\n';
const outputs={'docs/desktop-visual-inventory.json':json,'docs/desktop-visual-inventory.csv':csv};
if(process.argv.includes('--check')){
 for(const [file,value] of Object.entries(outputs))if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==value)throw new Error(`Outdated inventory: ${file}`);
}else for(const [file,value] of Object.entries(outputs))fs.writeFileSync(file,value);
console.log(`${rows.length} source files, ${rows.reduce((n,r)=>n+r.components.length,0)} component declarations; no runtime coverage inferred.`);
