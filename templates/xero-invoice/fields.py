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
    # page-number fields: give each part its own run (with formatting) so the number keeps the footer colour
    x=re.sub(r'<w:r>(<w:rPr>(?:(?!</w:rPr>).)*</w:rPr>)<w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve">(PAGE|NUMPAGES)</w:instrText><w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>',
      lambda m:'<w:r>'+m.group(1)+'<w:fldChar w:fldCharType="begin"/></w:r><w:r>'+m.group(1)+'<w:instrText xml:space="preserve"> '+m.group(2)+' </w:instrText></w:r><w:r>'+m.group(1)+'<w:fldChar w:fldCharType="separate"/></w:r><w:r>'+m.group(1)+'<w:t>1</w:t></w:r><w:r>'+m.group(1)+'<w:fldChar w:fldCharType="end"/></w:r>',x)
    if '⟦' in x:print('LEFTOVER token in',it.filename);sys.exit(1)
    data=x.encode('utf8')
  zout.writestr(it,data)
zout.close();print('fields placed',n,'of',len(fields))
