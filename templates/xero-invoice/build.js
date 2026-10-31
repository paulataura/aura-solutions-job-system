// Builds the Aura Xero custom invoice template (.docx with Xero merge fields) and a preview copy with sample values.
const fs=require('fs');const D=require('docx');
const {Document,Packer,Paragraph,TextRun,ImageRun,Table,TableRow,TableCell,WidthType,BorderStyle,ShadingType,AlignmentType,VerticalAlign,Footer,HorizontalPositionRelativeFrom,VerticalPositionRelativeFrom,TextWrappingType,TableLayoutType}=D;
const PREVIEW=process.argv[2]==='preview';
const GREEN='0C3E17',MID='2F6B3A',LIME='79CF36',GREY='5B6B60',LINE='CDD6CF',PALE='F6F9F6',HEAD='EEF4EF';
const FONT='Arial';
// merge field tokens: the text "⟦n⟧" is turned into a real Word MERGEFIELD afterwards
const fields=[];const SAMPLE={InvoiceTitle:'TAX INVOICE',InvoiceNumber:'INV-10225',InvoiceDate:'26 Oct 2026',InvoiceDueDate:'30 Nov 2026',Reference:'ASG-20261025-123138 / PO 0961',InvoiceAmountDue:'731.81',ContactName:'Zwanny LTD',ContactPostalAddress:'Unit 308, Woodside Way\nSpringvale Industrial Estate\nCwmbran, Torfaen  NP44 5BR',ContactTaxNumber:'',Description:'ASG-20261025-123138 · Unit 4, Hanson Way · 24/10/2026\nHaulage – bulk tanker',Quantity:'1.00',UnitAmount:'400.00',TaxPercentageOrName:'20%',LineAmount:'400.00',InvoiceSubTotal:'609.84',TaxCode:'VAT 20%',TaxTotal:'121.97',InvoiceTotal:'731.81',InvoiceTotalNetPayments:'0.00',PaymentMessageAndUrl:'View and pay online: https://in.xero.com/…',PaymentImage:'',TaxUnitName:'VAT'};
function F(name,sw){if(PREVIEW){if(/^Table(Start|End)/.test(name))return '';return SAMPLE[name]??'';}fields.push({name,sw:sw||''});return '⟦'+(fields.length-1)+'⟧';}
const run=(t,o={})=>new TextRun({text:t,font:FONT,size:o.size||18,bold:!!o.bold,color:o.color||'17221B',allCaps:!!o.caps,characterSpacing:o.spacing});
// a run list that may contain field tokens and newlines (preview text may have \n)
function runs(parts,o){if(!Array.isArray(parts))parts=[parts];const out=[];parts.forEach(p=>{if(typeof p!=='string'){out.push(p);return;}String(p).split('\n').forEach((s,i)=>{if(i)out.push(new TextRun({break:1}));if(s!=='')out.push(run(s,o));});});return out;}
const P=(parts,o={})=>new Paragraph({alignment:o.align,spacing:{before:o.before||0,after:o.after??40,line:o.line||260},keepNext:o.keepNext,shading:o.shade?{type:ShadingType.CLEAR,color:'auto',fill:o.shade}:undefined,border:o.border,indent:o.indent,children:runs(Array.isArray(parts)?parts:[parts],o)});
const NB={style:BorderStyle.NONE,size:0,color:'FFFFFF'};const NOB={top:NB,bottom:NB,left:NB,right:NB};
const B=(c=LINE,s=4)=>({style:BorderStyle.SINGLE,size:s,color:c});
const cell=(children,w,o={})=>new TableCell({width:{size:w,type:WidthType.DXA},children,borders:o.borders||NOB,shading:o.fill?{type:ShadingType.CLEAR,color:'auto',fill:o.fill}:undefined,margins:o.m||{top:60,bottom:60,left:110,right:110},verticalAlign:o.v||VerticalAlign.TOP,columnSpan:o.span});
const tbl=(widths,rows,o={})=>new Table({width:{size:widths.reduce((a,b)=>a+b,0),type:WidthType.DXA},columnWidths:widths,layout:TableLayoutType.FIXED,borders:o.borders||{top:NB,bottom:NB,left:NB,right:NB,insideHorizontal:NB,insideVertical:NB},rows});
const CW=10466; // A4 minus 0.6" margins (11906 - 2*720)
const money=n=>F(n,'\\# "#,##0.00;(#,##0.00)"');
// section heading: green number badge + title + lime rule
const H=(n,title)=>new Paragraph({spacing:{before:200,after:90},keepNext:true,border:{bottom:{style:BorderStyle.SINGLE,size:6,color:LIME,space:3}},children:[new TextRun({text:' '+n+' ',font:FONT,size:18,bold:true,color:'FFFFFF',shading:{type:ShadingType.CLEAR,color:'auto',fill:MID}}),new TextRun({text:'  '+title,font:FONT,size:23,bold:true,color:GREEN})]});
// box with a pale green title band
const box=(title,body,w)=>tbl([w],[new TableRow({children:[cell([P(title,{size:16,bold:true,color:MID,caps:true,spacing:10,after:0})],w,{fill:HEAD,borders:{top:B(),left:B(),right:B(),bottom:B()},m:{top:50,bottom:50,left:120,right:120}})]}),new TableRow({children:[cell(body,w,{borders:{top:NB,left:B(),right:B(),bottom:B()},m:{top:80,bottom:90,left:120,right:120}})]})]);
const kv=(k,v,w)=>tbl([w*0.34|0,w-(w*0.34|0)],[new TableRow({children:[cell([P(k,{color:GREY,size:17,after:0})],w*0.34|0,{m:{top:15,bottom:15,left:0,right:60}}),cell([P(v,{bold:true,size:17,after:0})],w-(w*0.34|0),{m:{top:15,bottom:15,left:0,right:0}})]})]);
const logo=fs.readFileSync(process.env.LOGO);const chev=fs.readFileSync('chevron.png'),band=fs.readFileSync('band.png');
const mm=n=>Math.round(n*36000);// EMU
// ---- header: logo left, title block right, chevron top-right of the page ----
const chevImg=new ImageRun({type:'png',data:chev,transformation:{width:378,height:35},floating:{horizontalPosition:{relative:HorizontalPositionRelativeFrom.PAGE,offset:mm(110)},verticalPosition:{relative:VerticalPositionRelativeFrom.PAGE,offset:0},behindDocument:true,allowOverlap:true,wrap:{type:TextWrappingType.NONE}}});
const half=CW/2|0;
const header=tbl([half,CW-half],[new TableRow({children:[
 cell([new Paragraph({children:[chevImg,new ImageRun({type:'png',data:logo,transformation:{width:190,height:Math.round(190*Number(process.env.LOGO_RATIO))}})]})],half,{m:{top:0,bottom:0,left:0,right:0},v:VerticalAlign.BOTTOM}),
 cell([P(F('InvoiceTitle','\\* Upper'),{size:38,bold:true,color:GREEN,align:AlignmentType.RIGHT,after:20,before:520}),P(F('InvoiceNumber'),{size:23,bold:true,align:AlignmentType.RIGHT,after:0})],CW-half,{m:{top:0,bottom:0,left:0,right:0},v:VerticalAlign.BOTTOM})]})]);
const rule=new Paragraph({spacing:{before:80,after:140},border:{bottom:{style:BorderStyle.SINGLE,size:6,color:MID,space:1}},children:[]});
// ---- key details strip ----
const sw=[1900,1800,1800,2866,2100];
const strip=(lbl,val,w,hl)=>cell([P(lbl,{size:14,color:GREY,caps:true,spacing:8,after:20}),P(val,{size:hl?22:18,bold:true,color:hl?GREEN:'17221B',after:0})],w,{fill:hl?'E3F2E6':PALE,borders:{top:B(),bottom:B(),left:B(),right:B()},m:{top:70,bottom:70,left:110,right:90}});
const keyStrip=tbl(sw,[new TableRow({children:[strip('Invoice number',F('InvoiceNumber'),sw[0]),strip('Issue date',F('InvoiceDate','\\@ "dd MMM yyyy"'),sw[1]),strip('Due date',F('InvoiceDueDate','\\@ "dd MMM yyyy"'),sw[2]),strip('Reference',F('Reference'),sw[3]),strip('Amount due',['£',money('InvoiceAmountDue')],sw[4],true)]})]);
// ---- 1. invoice to ----
const gap=160,bw=(CW-gap)/2|0;
const billTo=box('Bill to',[P(F('ContactName'),{bold:true,size:19,after:30}),P(F('ContactPostalAddress'),{size:17,after:30}),P([F('ContactTaxDisplayName'),' ',F('ContactTaxNumber')],{size:15,color:GREY,after:0})],bw);
const from=box('From',[kv('Company','Aura Solutions Group Limited',bw-240),kv('Address','Main Street, Sedgeberrow\nEvesham, Worcestershire\nWR11 7UH',bw-240),kv('Company no.','15761350 (England and Wales)',bw-240),kv('VAT no.','GB 471 3179 91',bw-240),kv('Queries','info@aurasolutions.co.uk\n01386 571556',bw-240)],bw);
const two=(a,b)=>tbl([bw,gap,CW-bw-gap],[new TableRow({children:[cell([a],bw,{m:{top:0,bottom:0,left:0,right:0}}),cell([P('')],gap,{m:{top:0,bottom:0,left:0,right:0}}),cell([b],CW-bw-gap,{m:{top:0,bottom:0,left:0,right:0}})]})]);
// ---- 2. charges ----
const lw=[5266,1100,1400,1100,1600];
const th=(t,w,al)=>cell([P(t,{size:14,bold:true,color:GREY,caps:true,spacing:8,align:al,after:0})],w,{fill:HEAD,borders:{top:B(),bottom:B(MID,6),left:NB,right:NB},m:{top:70,bottom:70,left:100,right:100}});
const td=(parts,w,al)=>cell([P(parts,{size:17,align:al,after:0})],w,{borders:{top:NB,bottom:B('E3E9E4'),left:NB,right:NB},m:{top:80,bottom:80,left:100,right:100}});
const R=AlignmentType.RIGHT;
const lines=tbl(lw,[new TableRow({tableHeader:true,children:[th('Description',lw[0]),th('Qty',lw[1],R),th('Unit price',lw[2],R),th(F('TaxUnitName'),lw[3],R),th('Amount £',lw[4],R)]}),
 new TableRow({cantSplit:true,children:[td([F('TableStart:LineItem'),F('Description')],lw[0]),td(F('Quantity','\\# #,##0.00##'),lw[1],R),td(F('UnitAmount','\\# "#,##0.00##;(#,##0.00##)"'),lw[2],R),td(F('TaxPercentageOrName'),lw[3],R),td([money('LineAmount'),F('TableEnd:LineItem')],lw[4],R)]})]);
if(PREVIEW){/* show the second sample line too */lines.root.push(new TableRow({cantSplit:true,children:[td('Disposal (m³) – check volume',lw[0]),td('6.88',lw[1],R),td('30.50',lw[2],R),td('20%',lw[3],R),td('209.84',lw[4],R)]}));}
const tw=[CW-4300,2700,1600];
const trow=(label,val,o={})=>new TableRow({cantSplit:true,children:[cell([P('')],tw[0],{m:{top:0,bottom:0,left:0,right:0}}),cell([P(label,{size:o.big?20:17,bold:!!o.big,color:o.big?GREEN:'17221B',after:0})],tw[1],{fill:o.fill,borders:{top:o.top?B(MID,6):NB,bottom:o.bottom?B():NB,left:NB,right:NB},m:{top:o.big?90:45,bottom:o.big?90:45,left:120,right:100}}),cell([P(val,{size:o.big?22:17,bold:!!o.big||!!o.b,color:o.big?GREEN:'17221B',align:R,after:0})],tw[2],{fill:o.fill,borders:{top:o.top?B(MID,6):NB,bottom:o.bottom?B():NB,left:NB,right:NB},m:{top:o.big?90:45,bottom:o.big?90:45,left:100,right:100}})]});
const totals=tbl(tw,[trow('Subtotal',['£',money('InvoiceSubTotal')]),
 new TableRow({cantSplit:true,children:[cell([P('')],tw[0],{m:{top:0,bottom:0,left:0,right:0}}),cell([P([F('TableStart:TaxSubTotal'),'Total ',F('TaxCode')],{size:17,after:0})],tw[1],{m:{top:45,bottom:45,left:120,right:100}}),cell([P(['£',money('TaxTotal'),F('TableEnd:TaxSubTotal')],{size:17,align:R,after:0})],tw[2],{m:{top:45,bottom:45,left:100,right:100}})]}),
 trow('Invoice total',['£',money('InvoiceTotal')],{top:true,b:true}),trow('Less payments',['£',money('InvoiceTotalNetPayments')]),trow('Amount due',['£',money('InvoiceAmountDue')],{big:true,fill:'E3F2E6'})]);
// ---- 3. how to pay ----
const bank=box('Bank transfer (BACS)',[kv('Bank','HSBC',bw-240),kv('Account name','Aura Solutions Group Limited',bw-240),kv('Sort code','40-18-00',bw-240),kv('Account no.','31377817',bw-240),kv('Reference',F('InvoiceNumber'),bw-240)],bw);
const terms=box('Terms',[P(['Payment is due by ',F('InvoiceDueDate','\\@ "d MMMM yyyy"'),' (30 days end of month). Please quote the invoice number as your reference and send remittance advice to info@aurasolutions.co.uk.'],{size:16,after:60}),
 P('No CIS deductions are to be made from this invoice.',{size:16,after:60}),
 P('Accounts not settled within terms may be charged interest and compensation under the Late Payment of Commercial Debts (Interest) Act 1998.',{size:15,color:GREY,after:60}),
 P(F('PaymentMessageAndUrl'),{size:16,color:MID,bold:true,after:0}),P(F('PaymentImage'),{after:0})],CW-bw-gap);
// ---- footer: dark green band across the page bottom ----
const bandImg=new ImageRun({type:'png',data:band,transformation:{width:794,height:72},floating:{horizontalPosition:{relative:HorizontalPositionRelativeFrom.PAGE,offset:0},verticalPosition:{relative:VerticalPositionRelativeFrom.PAGE,offset:mm(278)},behindDocument:true,allowOverlap:true,wrap:{type:TextWrappingType.NONE}}});
const fp=(parts,o={})=>new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:0,line:220},children:[...(o.img?[o.img]:[]),...runs(parts,{size:13,color:o.c||'FFFFFF',bold:o.bold})]});
const footer=new Footer({children:[fp('AURA SOLUTIONS GROUP LIMITED  ·  Registered office: Main Street, Sedgeberrow, Evesham, England, WR11 7UH',{img:bandImg,bold:true}),fp('Registered in England and Wales no. 15761350  ·  VAT no. GB 471 3179 91  ·  Registered waste carrier CBDU631384'),fp(['Invoice ',F('InvoiceNumber'),'  ·  Queries: info@aurasolutions.co.uk · 01386 571556'],{c:'B9D3BD'})]});
const doc=new Document({creator:'Aura Solutions Group Limited',title:'Aura invoice template',styles:{default:{document:{run:{font:FONT,size:18}}}},
 sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:567,bottom:1080,left:720,right:720,header:300,footer:300}}},footers:{default:footer},
 children:[header,rule,keyStrip,H(1,'Invoice to'),two(billTo,from),H(2,'Charges'),lines,new Paragraph({spacing:{after:60},children:[]}),totals,H(3,'How to pay'),two(bank,terms)]}]});
Packer.toBuffer(doc).then(buf=>{fs.writeFileSync(PREVIEW?'preview.docx':'raw.docx',buf);fs.writeFileSync('fields.json',JSON.stringify(PREVIEW?[]:fields));console.log('written',PREVIEW?'preview':'raw',fields.length,'fields');});
