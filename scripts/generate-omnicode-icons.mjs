import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {chromium} from '@playwright/test';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const design=path.join(root,'design/omnicode-brand-v10/svg');
const work=path.join(root,'.tmp/omnicode-native');
const mark=await fs.readFile(path.join(design,'omnicode-mark-white.svg'),'utf8');
const body=mark.slice(mark.indexOf('<g '),mark.lastIndexOf('</svg>'));
const svg=(content,w=256,h=w)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${content}</svg>`;

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const windowsOnly=process.argv.includes('--windows-only');
  await fs.mkdir(work,{recursive:true});
  const app=svg(`<rect width="256" height="256" rx="56" fill="#151515"/><g transform="translate(24 24) scale(.8125)">${body}</g>`);
  const square=svg(`<rect width="256" height="256" fill="#151515"/><g transform="translate(24 24) scale(.8125)">${body}</g>`);
  const sidebar=svg(`<rect width="164" height="314" fill="#151515"/><g transform="translate(22 92) scale(.46875)">${body}</g>`,164,314);
  const browser=await chromium.launch({headless:true});
  try{
    for(const [name,source,w,h] of [['mark',mark,1024,1024],['app',app,1024,1024],['square',square,1024,1024],['sidebar',sidebar,164,314]]){
      if(windowsOnly&&name!=='app')continue;
      const page=await browser.newPage({viewport:{width:w,height:h}});
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:100vw;height:100vh;display:block}</style>${source}`);
      await page.screenshot({path:path.join(work,`${name}.png`),omitBackground:true});await page.close();
    }
  }finally{await browser.close();}
  const result=spawnSync('python',[path.join(root,'scripts/generate-omnicode-native.py'),work,...(windowsOnly?['--windows-only']:[])],{stdio:'inherit',cwd:root});
  if(result.status!==0)throw new Error('Native icon conversion failed');
}
