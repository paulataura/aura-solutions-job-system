# Turns ⟦n⟧ placeholder runs into real Word MERGEFIELDs (same form Xero's own sample uses)
import json,re,zipfile,sys,shutil
src,dst=sys.argv[1],sys.argv[2];fields=json.load(open('fields.json'))
zin=zipfile.ZipFile(src);zout=zipfile.ZipFile(dst,'w',zipfile.ZIP_DEFLATED);n=0
def esc(s):return s.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('"','&quot;')
for it in zin.infolist():
  data=zin.read(it.filename)
  if it.filename.startswith('word/') and it.filename.endswith('.xml'):
    x=data.decode('utf8')
    def rep(m):
      global n;rpr=m.group(1) or '';f=fields[int(m.group(2))];n+=1
      instr=' MERGEFIELD  '+f['name']+('  '+f['sw'] if f['sw'] else '')+'  \\* MERGEFORMAT '
      r=lambda inner:'<w:r>'+rpr+inner+'</w:r>'
      return r('<w:fldChar w:fldCharType="begin"/>')+r('<w:instrText xml:space="preserve">'+esc(instr)+'</w:instrText>')+r('<w:fldChar w:fldCharType="separate"/>')+r('<w:t xml:space="preserve">«'+esc(f['name'])+'»</w:t>')+r('<w:fldChar w:fldCharType="end"/>')
    x=re.sub(r'<w:r>(<w:rPr>(?:(?!</w:rPr>).)*</w:rPr>)?<w:t xml:space="preserve">⟦(\d+)⟧</w:t></w:r>',rep,x)
    if '⟦' in x:print('LEFTOVER token in',it.filename);sys.exit(1)
    data=x.encode('utf8')
  zout.writestr(it,data)
zout.close();print('fields placed',n,'of',len(fields))
