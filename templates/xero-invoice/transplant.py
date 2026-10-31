# Puts our document into Xero's own sample package (their styles/settings/theme), repacked the way Word writes files.
import os,re,shutil,zipfile,sys
src,out=sys.argv[1],sys.argv[2];noqr=len(sys.argv)>3
T='tp';shutil.rmtree(T,ignore_errors=True);os.makedirs(T)
zipfile.ZipFile('src/UKInvoice.docx').extractall(T)
O='tp_ours';shutil.rmtree(O,ignore_errors=True);zipfile.ZipFile(src).extractall(O)
for f in ['word/document.xml','word/header1.xml','word/header2.xml','word/header3.xml','word/footer1.xml','word/footer2.xml','word/footer3.xml','word/media/image1.png']:
  p=os.path.join(T,f)
  if os.path.exists(p):os.remove(p)
os.makedirs(T+'/word/media',exist_ok=True);os.makedirs(T+'/word/_rels',exist_ok=True)
for f in os.listdir(O+'/word/media'):shutil.copy(O+'/word/media/'+f,T+'/word/media/'+f)
doc=open(O+'/word/document.xml',encoding='utf8').read()
f1=open(O+'/word/footer1.xml',encoding='utf8').read();f2=open(O+'/word/footer2.xml',encoding='utf8').read()
if noqr:
  # test variant: no payment image / link fields in the footer
  for nm in ['PaymentImage','PaymentMessageAndUrl']:
    f2=re.sub(r'<w:r>(?:(?!<w:r>).)*?<w:fldChar w:fldCharType="begin"/></w:r><w:r>(?:(?!<w:r>).)*?MERGEFIELD  '+nm+r'.*?<w:fldChar w:fldCharType="end"/></w:r>','',f2,flags=re.S)
# footer image rels: rId0/rId1 -> rId100/rId101
fr=open(O+'/word/_rels/footer1.xml.rels',encoding='utf8').read()
for f,x in [('footer1.xml',f1),('footer2.xml',f2)]:
  x=x.replace('r:embed="rId0"','r:embed="rId100"').replace('r:embed="rId1"','r:embed="rId101"')
  open(T+'/word/'+f,'w',encoding='utf8').write(x)
  open(T+'/word/_rels/'+f+'.rels','w',encoding='utf8').write(fr.replace('Id="rId0"','Id="rId100"').replace('Id="rId1"','Id="rId101"'))
open(T+'/word/document.xml','w',encoding='utf8').write(doc)
ours_rels=open(O+'/word/_rels/document.xml.rels',encoding='utf8').read()
imgs=re.findall(r'<Relationship Id="(rId\d+)" Type="[^"]*/image" Target="([^"]+)"/>',ours_rels)
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
rels=[('rId1','customXml','../customXml/item1.xml'),('rId2','styles','styles.xml'),('rId3','settings','settings.xml'),('rId4','webSettings','webSettings.xml'),('rId5','footnotes','footnotes.xml'),('rId6','footer','footer1.xml'),('rId7','footer','footer2.xml'),('rId8','endnotes','endnotes.xml'),('rId14','fontTable','fontTable.xml'),('rId15','theme','theme/theme1.xml')]+[(i,'image',t) for i,t in imgs]
open(T+'/word/_rels/document.xml.rels','w',encoding='utf8').write('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+''.join('<Relationship Id="%s" Type="%s%s" Target="%s"/>'%(i,R,t,g) for i,t,g in rels)+'</Relationships>')
# document's footer references must match rId6 (default) and rId7 (first) – same as ours
assert 'r:id="rId6"' in doc and 'r:id="rId7"' in doc
ct=open(T+'/[Content_Types].xml',encoding='utf8').read()
ct=re.sub(r'<Override PartName="/word/(header\d|footer3)\.xml"[^>]*/>','',ct)
if 'Extension="png"' not in ct:ct=ct.replace('<Default Extension="rels"','<Default Extension="png" ContentType="image/png"/><Default Extension="rels"')
open(T+'/[Content_Types].xml','w',encoding='utf8').write(ct)
# repack: [Content_Types].xml first, no directory entries
files=[]
for root,_,fs in os.walk(T):
  for f in fs:files.append(os.path.relpath(os.path.join(root,f),T))
files.sort(key=lambda p:(p!='[Content_Types].xml',not p.startswith('_rels'),p))
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
  for f in files:z.write(os.path.join(T,f),f)
print('wrote',out,len(files),'parts')
