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

async function header(browser){
  const wordmark=await fs.readFile(path.join(design,'omnicode-horizontal-black.svg'),'utf8');
  const page=await browser.newPage();
  try {
    const rgba=await page.evaluate(async source=>{
      const img=new Image();img.src='data:image/svg+xml;base64,'+btoa(source);await img.decode();
      const canvas=document.createElement('canvas');canvas.width=150;canvas.height=57;
      const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,150,57);ctx.drawImage(img,6,16,138,138*144/805);
      return Array.from(ctx.getImageData(0,0,150,57).data);
    },wordmark);
    const stride=452,bmp=Buffer.alloc(54+stride*57);
    bmp.write('BM');bmp.writeUInt32LE(bmp.length,2);bmp.writeUInt32LE(54,10);bmp.writeUInt32LE(40,14);
    bmp.writeInt32LE(150,18);bmp.writeInt32LE(57,22);bmp.writeUInt16LE(1,26);bmp.writeUInt16LE(24,28);bmp.writeUInt32LE(stride*57,34);
    for(let y=0;y<57;y++)for(let x=0;x<150;x++){
      const src=(y*150+x)*4,dst=54+(56-y)*stride+x*3;
      bmp[dst]=rgba[src+2];bmp[dst+1]=rgba[src+1];bmp[dst+2]=rgba[src];
    }
    await fs.writeFile(path.join(root,'src-tauri/installer/omnicode-header.bmp'),bmp);
  } finally {await page.close();}
}

export async function generateInstallerHeader(){
  const browser=await chromium.launch({headless:true});
  try {await header(browser);}finally{await browser.close();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await fs.mkdir(work,{recursive:true});
  const app=svg(`<rect width="256" height="256" rx="56" fill="#151515"/><g transform="translate(24 24) scale(.8125)">${body}</g>`);
  const square=svg(`<rect width="256" height="256" fill="#151515"/><g transform="translate(24 24) scale(.8125)">${body}</g>`);
  const sidebar=svg(`<rect width="164" height="314" fill="#151515"/><g transform="translate(22 92) scale(.46875)">${body}</g>`,164,314);
  const browser=await chromium.launch({headless:true});
  try{
    for(const [name,source,w,h] of [['mark',mark,1024,1024],['app',app,1024,1024],['square',square,1024,1024],['sidebar',sidebar,164,314]]){
      const page=await browser.newPage({viewport:{width:w,height:h}});
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:100vw;height:100vh;display:block}</style>${source}`);
      await page.screenshot({path:path.join(work,`${name}.png`),omitBackground:true});await page.close();
    }
    await header(browser);
  }finally{await browser.close();}
  const result=spawnSync('python',[path.join(root,'scripts/generate-omnicode-native.py'),work],{stdio:'inherit',cwd:root});
  if(result.status!==0)throw new Error('Native icon conversion failed');
}
