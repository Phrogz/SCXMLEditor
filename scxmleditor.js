'use strict';

const SSE = {};
const nvNS  = 'http://nvidia.com/drive/architect';
const svgNS = 'http://www.w3.org/2000/svg';

SSE.Canvas = function(svg, scxmlDoc)
{
	this.svg         = svg;
	this.transCombos = {};
	this.selection   = [];
	this.g = {
		shadows : make('g', {_dad:svg, id:'shadows'}),
		content : make('g', {_dad:svg, id:'content'}),
		heads   : make('g', {_dad:svg, id:'heads'}),
	};
	this.gridSize = 10;
	this.gridActive = true;
	document.body.addEventListener('mousedown', _=>this.select(), false);

	if (scxmlDoc) this.useSCXML(scxmlDoc);
}

SSE.Canvas.prototype.useSCXML = function(scxmlDoc)
{
	this.scxmlDoc = scxmlDoc;
	this.observer = new MutationObserver(this.onDocChange.bind(this));
	this.observer.observe(scxmlDoc.root, {childList:true, attributes:true, subtree:true});

	Object.setPrototypeOf(SSE.State, Object.getPrototypeOf(scxmlDoc.root));

	// Turn off the grid when setting the initial positions of items
	this.gridActive = false;
	scxmlDoc.states.forEach(this.addState.bind(this));
	scxmlDoc.transitions.forEach(this.addTransition.bind(this));
	this.gridActive = true;
};

SSE.Canvas.prototype.addState = function(state)
{
	// The root SCXML element does not get displayed visually
	if (state===this.scxmlDoc.root) return;

	Object.setPrototypeOf(state, SSE.State);

	const ego = state._sse = {
		canvas:   this,
		shadow:   make('rect', {rx:10, ry:10}),
		main:     make('g', {transform:'translate(0,0)', 'class':'state'}),
		incoming: [],
		outgoing: [],
	};
	if (state.states.length) ego.main.classList.add('parent');
	ego.tx = ego.main.transform.baseVal.getItem(0);
	ego.rect  = make('rect', {_dad:ego.main, rx:10, ry:10});
	ego.label = make('text', {_dad:ego.main, _text:state.id});
	// canvas.makeDraggable(this.main, this);

	this.g.shadows.appendChild(ego.shadow);
	this.g.content.appendChild(ego.main);

	state.xywh = state.xywh;
	// state.updateAttribute('rgba');

	ego.main.addEventListener('mousedown', evt=>{
		evt.stopPropagation();
		this.select(state);
	}, false);
};

SSE.Canvas.prototype.addTransition = function(start,end,events)
{
	// var t = new SSE.Transition(this,start,end,events);
	// this.g.transitions.appendChild(t.main);
	// this.g.heads.appendChild(t._heads);
	// this.transitions.push(t);

	// if (!this.transCombos[start]) this.transCombos[start] = {};
	// if (!this.transCombos[start][end]) this.transCombos[start][end] = [];
	// this.transCombos[start][end].push(t);

	// var me = this;
	// t.main.addEventListener('mousedown',function(evt){
	// 	evt.stopPropagation();
	// 	me.select(t);
	// },false);

	// return t;
};

SSE.Canvas.prototype.transitionsBetween = function(start,end){
	if (!this.transCombos[start]) return [];
	return this.transCombos[start][end] || [];
}

SSE.Canvas.prototype.makeDraggable = function(el,obj){
	el.addEventListener('mousedown',function(evt){
		// TODO: Transform from screen to SVG space for viewBox'd content
		var lastX=evt.clientX, lastY=evt.clientY, dragging=false;
		document.body.addEventListener('mousemove',onmove,false);
		function onmove(evt){
			evt.stopPropagation();
			if (!dragging && (dragging=true) && obj.startDragging) obj.startDragging();
			if (obj.handleDrag) obj.handleDrag(evt.clientX-lastX,evt.clientY-lastY);
			lastX = evt.clientX;
			lastY = evt.clientY;
		}
		document.body.addEventListener('mouseup',function(){
			document.body.removeEventListener('mousemove',onmove,false);
			if (obj.finishDragging) obj.finishDragging();
		},false);
	},false);
}

SSE.Canvas.prototype.select = function(item){
	this.selection.forEach(i => i.deselect());
	this.selection.length = 0;
	if (item){
		this.selection.push(item);
		item.select();
	}
}

SSE.Canvas.prototype.snap = function(n){
	if (this.gridActive) {
		if (n.map) n=n.map(v=>Math.round(v/this.gridSize)*this.gridSize);
		else       n=Math.round(n/this.gridSize)*this.gridSize;
	}
	return n;
}

SSE.Canvas.prototype.onDocChange = function(mutationList){
	mutationList.forEach(m => {
		switch(m.type) {
			case 'childList':
				m.addedNodes.forEach(n => {
					console.log('TODO: maybe create a new visual node for', n);
				});
				m.removedNodes.forEach(n => {
					if (this.docNodeToSSE.has(n)) {
						console.log('TODO: remove SSE node for', n);
					}
				});
			break;
			case 'attributes':
				if (m.target.updateAttribute) m.target.updateAttribute(m.attributeNamespace, m.attributeName);
			break;
		}
	});
}

// ****************************************************************************
// ****************************************************************************
// ****************************************************************************


SSE.State = Object.defineProperties({
	startDragging(){
		// Re-order this state to the top
		// TODO: do this to all its children, too
		this._sse.main.parentNode.appendChild(this.main);
		this._x = this.x;
		this._y = this.y;
	},

	handleDrag(dx,dy){
		this.xy = [this._x+dx, this._y+dy];
	},

	select(){
		this._sse.main.classList.add('selected');
	},

	deselect(){
		this._sse.main.classList.remove('selected');
	},

	updateAttribute(attrNS, attrName){
		const val = this.getAttributeNS(attrNS, attrName);
		switch(attrName){
			case 'xywh':
				const ego = this._sse;
				const [x,y,w,h] = val.split(/\s+/).map(Number);
				ego.tx.setTranslate(x, y);
				setAttributes(ego.shadow, {x:x, y:y});
				ego.incoming.forEach(ƒ('pickPath'));
				ego.outgoing.forEach(ƒ('pickPath'));

				setAttributes(ego.rect,   {width:w, height:h});
				setAttributes(ego.shadow, {width:w, height:h});
				const labelAtTop = this.states.length>0;
				const top = labelAtTop ? 15 : h/2;
				setAttributes(ego.label,  {x:w/2, y:top});
				ego.incoming.forEach(ƒ('pickPath'));
				ego.outgoing.forEach(ƒ('pickPath'));

				this.updateContainment();
			break;
		}
	},

	updateContainment(){
		this._sse.main.classList[this.containedWithinParent ? 'remove' : 'add']('containmentError');
		this.states.forEach(ƒ('updateContainment'));
	},
},{
	x: {
		get(){ return this.xywh[0] },
		set(x){ const xywh=this.xywh; xywh[0]=this._sse.canvas.snap(x); this.xywh=xywh }
	},
	y: {
		get(){ return this.xywh[1] },
		set(y){ const xywh=this.xywh; xywh[1]=this._sse.canvas.snap(y); this.xywh=xywh }
	},
	w: {
		get(){ return this.xywh[2] },
		set(w){ const xywh=this.xywh; xywh[2]=this._sse.canvas.snap(w); this.xywh=xywh }
	},
	h: {
		get(){ return this.xywh[3] },
		set(h){ const xywh=this.xywh; xywh[3]=this._sse.canvas.snap(h); this.xywh=xywh }
	},
	xy: {
		get(){ return this.xywh.slice(0,2) },
		set(xy){ const xywh=this.xywh; [xywh[0], xywh[1]]=this._sse.canvas.snap(xy); this.xywh=xywh }
	},
	wh: {
		get(){ return this.xywh.slice(2) },
		set(wh){ const xywh=this.xywh; [xywh[2], xywh[3]]=this._sse.canvas.snap(wh); this.xywh=xywh }
	},
	xywh: {
		get(){
            const xywh=this.getAttributeNS(nvNS, 'xywh');
            return xywh ? xywh.split(/\s+/).map(Number) : [0,0,100,60];
		},
		set(xywh){ this.setAttributeNS(nvNS, 'xywh', xywh.join(' ')) }
	},

	containedWithinParent:{
		get()
		{
			if (this.parent.isSCXML) return true;
			const dad=this.parent.xywh, ego=this.xywh;
			return (ego[0]>=dad[0] && ego[1]>=dad[1] &&
			        (ego[0]+ego[2])<=(dad[0]+dad[2]) &&
			        (ego[1]+ego[3])<=(dad[1]+dad[3]));
		}
	},

	r: {
		get(){ return this.rgba[0] },
		set(r){ const rgba=this.rgba; rgba[0]=r; this.rgba=rgba }
	},
	g: {
		get(){ return this.rgba[1] },
		set(g){ const rgba=this.rgba; rgba[1]=g; this.rgba=rgba }
	},
	b: {
		get(){ return this.rgba[2] },
		set(b){ const rgba=this.rgba; rgba[2]=b; this.rgba=rgba }
	},
	a: {
		get(){ return this.rgba[3] },
		set(a){ const rgba=this.rgba; rgba[3]=a; this.rgba=rgba }
	},
	rgba: {
		get(){
			const rgba = this.getAttributeNS(nvNS, 'rgba') || 'FFFFFF80';
			return rgba.match(/[\da-f]{2}/gi).map(s=>parseInt(s,16));
		},
		set(rgba){ this.setAttributeNS(nvNS, 'rgba', array.map(toHex255).join('')) }
	},
});

// SSE.State.prototype.xy = function(x, y)
// {
// 	const xywh = this.node.xywh;
// 	this._x = x;
// 	this._y = y;
// 	if (this.canvas.gridActive)
// 	{
// 		[x,y] = [x,y].map(n => Math.round(n/this.canvas.gridSize)*this.canvas.gridSize);
// 	}
// 	xywh[0] = x;
// 	xywh[1] = y;
// 	this._tx.setTranslate(x, y);
// 	setAttributes(this.shadow, {x:x, y:y});
// 	this.incoming.forEach(ƒ('pickPath'));
// 	this.outgoing.forEach(ƒ('pickPath'));
// 	this.main.classList[this.containedWithinParent ? 'remove' : 'add']('containmentError');
// }

// SSE.State.prototype.wh = function(w, h)
// {
// 	const xywh = this.node.xywh;
// 	if (this.canvas.gridActive)
// 	{
// 		[w,h] = [w,h].map(n => Math.round(n/this.canvas.gridSize)*this.canvas.gridSize);
// 	}
// 	xywh[2] = w;
// 	xywh[3] = h;
// 	setAttributes(this.rect,   {width:w, height:h});
// 	setAttributes(this.shadow, {width:w, height:h});
// 	const labelAtTop = this.node.states.length>0;
// 	const y = labelAtTop ? 15 : h/2;
// 	setAttributes(this.label,  {x:w/2, y:y});
// 	this.incoming.forEach(ƒ('pickPath'));
// 	this.outgoing.forEach(ƒ('pickPath'));
// 	this.main.classList[this.containedWithinParent ? 'remove' : 'add']('containmentError');
// }

// SSE.State.prototype

        // Array of position and size of this state, in global document coordinates
        // Mutating this array will not affect the document; you must assign an array to this property
        // xywh:{
        //     get()
        //     {
        //         const xywh = this.getAttributeNS(NVNS, 'xywh');
        //         return xywh ? xywh.split(/\s+/).map(Number) : [0,0,100,60];
        //     },
        //     set(array)
        //     {
        //
        //     },
        // },

        // Array of color values for this state, all in the range [0,255]
        // Mutating this array will not affect the document; you must assign an array to this property
        // rgba:{
        //     get()
        //     {
        //         const rgba = this.getAttributeNS(NVNS, 'rgba') || 'FFFFFF80';
        //         return rgba.match(/[\da-f]{2}/gi).map(s=>parseInt(s,16));
        //     },
        //     set(array)
        //     {
        //         this.setAttributeNS(NVNS, 'rgba', array.map(toHex255).join(''));
        //     },
        // },



// ****************************************************************************
// ****************************************************************************
// ****************************************************************************

/*
SSE.Transition = function(canvas,start,end,events){
	this.canvas = canvas;
	this.start  = start;
	this.end    = end;
	this.main   = };
SSE.Transition.prototype.pickPath = function(){
	var s0=this.start, s1=this.end;
	var pad = 25;
	var w=SSE.State.shape.width, h=SSE.State.shape.height;
	var xQuad = (s0.x-pad > s1.x+w) ? -1 : (s1.x-pad > s0.x+w) ? 1 : 0;
	var yQuad = (s0.y-pad > s1.y+h) ? -1 : (s1.y-pad > s0.y+h) ? 1 : 0;
	this.s0Vert = this.s1Vert = true;
	switch(yQuad){
		case -1:
			this._x1=s0.x+w/2;
			this._y1=s0.y;
			this._x2=s1.x+w/2;
			this._y2=s1.y+h;
		break;
		case 0:
			this.s0Vert = this.s1Vert = false;
			this._x1 = (xQuad<1) ? s0.x : s0.x+w;
			this._y1 = s0.y+h/2;
			this._x2 = (xQuad<1) ? s1.x+w : s1.x;
			this._y2 = s1.y+h/2;
		break;
		case 1:
			this._x1=s0.x+w/2;
			this._y1=s0.y+h;
			this._x2=s1.x+w/2;
			this._y2=s1.y;
		break;
	}
	this.mid = [
		this._x1+(this._x2-this._x1)/2,
		this._y1+(this._y2-this._y1)/2
	];
	this.redraw();
};
SSE.Transition.prototype.redraw = function(){
	var pts = [];
	pts.push([this._x1,this._y1]);
	if (this.s0Vert==this.s1Vert){
		pts.push([this._x1+(this._x2-this._x1)/2,this._y1+(this._y2-this._y1)/2]);
	}
	pts.push([this._x2,this._y2]);
	var commands = ['M'+pts[0].join()];
	for (var i=0,len=pts.length-1,vert=this.s0Vert;i<len;++i,vert=!vert){
		var p0=pts[i], p1=pts[i+1], dx=p1[0]-p0[0], dy=p1[1]-p0[1];
		var d = Math.min(Math.abs(dx),Math.abs(dy)) / tightness;
		tx  = dx<0 ? -d : d;
		ty  = dy<0 ? -d : d;
		if (vert ? dy<0 : dx<0) d=-d;
		// commands.push( vert ? 'V'+p1[1]+'H'+p1[0] : 'H'+p1[0]+'V'+p1[1] );
		if (vert) commands.push( 'v'+(dy-ty)+('a'+[d,d,0,0,dx*dy>0?0:1,tx,ty].join())+'H'+p1[0] );
		else      commands.push( 'h'+(dx-tx)+('a'+[d,d,0,0,dx*dy>0?1:0,tx,ty].join())+'V'+p1[1] );
	}
	this._path.setAttribute('d',commands.join(' '));
	this._heads.setAttribute('d',commands.join(' '));
};

SSE.Transition.prototype.select = function(){
	this.main.parentNode.appendChild(this.main);
	SSE.addClass(this.main,'selected');
};

SSE.Transition.prototype.deselect = function(){
	SSE.removeClass(this.main,'selected');
};
*/

function ƒ(name){
	let v;
	const params=Array.prototype.slice.call(arguments,1);
	return o=>(typeof (v=o[name])==='function' ? v.apply(o,params) : v);
}

function setAttributes(node, attr={}){
	for (const k of Object.keys(attr)){
		node.setAttribute(k, attr[k]);
	}
}

function make(name, opts={}){
	const el = document.createElementNS(svgNS, name);
	for (const k of Object.keys(opts)){
		switch(k){
			case '_dad':
				opts[k].appendChild(el);
			break;

			case '_text':
				el.appendChild(document.createTextNode(opts[k]));
			break;

			default:
				el.setAttribute(k, opts[k]);
		}
	}
	return el;
}

export default SSE.Canvas;
