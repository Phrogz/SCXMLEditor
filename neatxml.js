export default NeatXML;

// NeatXML v0.9 Copyright ©2018 Gavin Kistner <!@phrogz.net>
// Licensed under the "MIT License"
// See https://github.com/Phrogz/NeatXML/LICENSE.txt for details.

function NeatXML(node, opts={}) {
   const out = [];
   const tab = opts.indent ? (typeof opts.indent==="number" ? (" ").repeat(opts.indent) : opts.indent) : '';
   const omit = new Set(typeof opts.omitNS==='string' ? [opts.omitNS] : opts.omitNS || []);
   const xmlns='http://www.w3.org/2000/xmlns/';
   const nsToPrefix = [{[xmlns]:'xmlns', 'http://www.w3.org/XML/1998/namespace':'xml'}];
   const serializer = {};
   const attresc = {"<":"&lt;", "&":"&amp;", '"':"&quot;"};
   const textesc = {"<":"&lt;", "&":"&amp;"};

   serializer[Node.DOCUMENT_NODE] = function(n) {
      for (const kid of n.childNodes) serializer[kid.nodeType](kid,0);
   }

   serializer[Node.PROCESSING_INSTRUCTION_NODE] = function(n,depth=0) {
      out.push(`${tab.repeat(depth)}<?${n.nodeName} ${n.nodeValue}?>`);
   }

   serializer[Node.ELEMENT_NODE] = function(n,depth=0) {
      if (omit.has(n.namespaceURI)) return;

      const nsLookup = Object.assign({},nsToPrefix[nsToPrefix.length-1]);
      nsToPrefix.push(nsLookup);

      const generatedNS = [];
      function makePrefix(nsuri, base='ns') {
         const prefixes = new Set(Object.values(nsLookup));
         const prefixbase = base || 'ns';
         let i=0, prefix=prefixbase;
         while (prefixes.has(prefix)) prefix = `${prefixbase}${++i}`;
         nsLookup[nsuri]=prefix;
         const a = n.ownerDocument.createAttributeNS(xmlns,`xmlns:${prefix}`);
         a.nodeValue = nsuri;
         generatedNS.push(a);
      }

      if (n.attributes.length) {
         for (const a of n.attributes) {
            if      (a.prefix=='xmlns')    nsLookup[a.nodeValue] = a.localName;
            else if (a.localName=='xmlns') nsLookup[a.nodeValue] = false; // Indicate to elements that this namespace is the default
         }
         // Check for additional namespaces needed only after doing a full attribute scan
         for (const a of n.attributes) if (a.namespaceURI && !nsLookup[a.namespaceURI]) makePrefix(a.namespaceURI, a.prefix);
      }
      if (n.namespaceURI && nsLookup[n.namespaceURI]===undefined) makePrefix(n.namespaceURI, n.prefix);

      const nodeprefix = (n.namespaceURI && nsLookup[n.namespaceURI]) ? nsLookup[n.namespaceURI] : null;
      const name = nodeprefix ? `${nodeprefix}:${n.localName}` : n.localName;
      const indent = tab.repeat(depth);
      const result = [indent,'<',name];
      if (n.attributes.length + generatedNS.length) {
         const sorted = Array.from(n.attributes).concat(generatedNS);
         for (const a of sorted) {
            a._prefix = a.namespaceURI && a.localName!=='xmlns' ? nsLookup[a.namespaceURI] : null;
            a._nsname = a._prefix ? `${a._prefix}:${a.localName}` : a.localName;
         }
         if (opts.sort) {
            sorted.sort(function(a,b){
               if ((a._prefix && b._prefix) || (!a._prefix && !b._prefix)) {
                  return a._nsname<b._nsname ? -1 : a._nsname>b._nsname ? 1 : 0;
               } else if (b._prefix) {
                  return -1;
               } else {
                  return 1;
               }
            });
         }
         for (const a of sorted) {
            if (!omit.has(a.namespaceURI) && !(omit.has(a.nodeValue) && a.prefix=='xmlns')) {
               result.push(` ${a._nsname}="${a.nodeValue.replace(/[<&"]/g, s=>attresc[s])}"`);
            }
         }
      }

      const openTag = result.join('');
      const openIndex = out.push(openTag)-1;
      if (n.childNodes.length) for (const kid of n.childNodes) serializer[kid.nodeType](kid, depth+1);
      if (out.length===openIndex+1){
         // self-close after seeing whether or not any nodes were added, because
         // we cannot test for n.childNodes.length because opts.strip or opts.omitNS may remove all children
         out[openIndex] = openTag+'/>';
      }
      else {
         out[openIndex] = openTag+'>';
         out.push(`${indent}</${name}>`);
      }

      nsToPrefix.pop();
   };

   serializer[Node.TEXT_NODE] = function(n,depth=0) {
      const text = opts.strip ? n.nodeValue.trim() : n.nodeValue;
      if (text) {
         if (opts.cdata===true) serializer[Node.CDATA_SECTION_NODE](n,depth);
         else out.push(`${tab.repeat(depth)}${text.replace(/[<&]/g, s=>textesc[s])}`);
      }
   };

   serializer[Node.CDATA_SECTION_NODE] = function(n,depth=0) {
      if (opts.cdata===false) return serializer[Node.TEXT_NODE](n,depth);
      out.push(`${tab.repeat(depth)}<![CDATA[${n.nodeValue}]]>`);
   };

   serializer[Node.COMMENT_NODE] = function(n,depth=0) {
      out.push(`${tab.repeat(depth)}<!--${n.nodeValue}-->`);
   }

   serializer[node.nodeType](node, 0);

   return out.join(opts.indent ? '\n' : '');
}