import {describe,it,expect} from 'vitest';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const workflow=readFileSync(new URL('../../../.github/workflows/paper-forward.yml',import.meta.url),'utf8');
const step=workflow.split('      - name: Tageslauf nur mit Spielgeld\n')[1]!.split('      - name:')[0]!;
const script=step.split('        run: |\n')[1]!.split('\n').map(line=>line.replace(/^          /,'')).join('\n');
describe('forward workflow modes',()=>{
 it('defaults to manual dry-run and separately gates persistence and its secret',()=>{
  expect(workflow).toMatch(/dry_run:[\s\S]*?type: boolean\n\s+default: true/);
  expect(workflow).toContain("if: (github.event_name == 'workflow_dispatch' && inputs.dry_run) || vars.FORWARD_ENABLED == 'true'");
  const storage=workflow.split('      - name: Datenschutz prüfen und Ergebnisse speichern')[1]!;
  expect(storage).toContain("if: env.FORWARD_DRY_RUN != 'true' && vars.FORWARD_ENABLED == 'true'");
  expect(storage).toContain('PRIVACY_BLOCKLIST: ${{ secrets.PRIVACY_BLOCKLIST }}');
 });
 it('runs only --dry-run with forward disabled and fails a disabled real run',()=>{
  const dir=mkdtempSync(join(tmpdir(),'forward-workflow-'));
  writeFileSync(join(dir,'pnpm'),'#!/bin/sh\nprintf "%s\\n" "$@"\n',{mode:0o755});
  try{
   const env={...process.env,PATH:dir+':'+process.env.PATH,FORWARD_ENABLED:'',FORWARD_START:'2026-01-01',FORWARD_DRY_RUN:'true'};
   const dry=spawnSync('bash',['-c',script],{env,encoding:'utf8'});
   expect(dry.status).toBe(0);expect(dry.stdout.split('\n')).toContain('--dry-run');
   expect(dry.stdout).not.toContain('2026-01-01');
   const disabled=spawnSync('bash',['-c',script],{env:{...env,FORWARD_DRY_RUN:'false'},encoding:'utf8'});
   expect(disabled.status).not.toBe(0);expect(disabled.stdout).toBe('');
  }finally{rmSync(dir,{recursive:true});}
 });
});
