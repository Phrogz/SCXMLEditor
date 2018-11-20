'use strict';

const SSE = {};
const nvNS  = 'http://nvidia.com/drive/architect';
const svgNS = 'http://www.w3.org/2000/svg';

SSE.Editor = function(svg, scxmlDoc) {
    this.svg         = svg;
    this.transCombos = {};
    this.selection   = [];
    this.g = {
        shadows : make('g', {_dad:svg, id:'shadows'}),
        content : make('g', {_dad:svg, id:'content'}),
        transitions : make('g', {_dad:svg, id:'transitions'}),
    };
    this.gridSize = 10;
    this.gridActive = true;
    document.body.addEventListener('mousedown', this.select.bind(this), false);

    if (scxmlDoc) this.useSCXML(scxmlDoc);
}

Object.defineProperties(SSE.Editor.prototype, {
    maxRadius:{
        get()
        {
            return this._maxRadius || 100;
        },
        set(r)
        {
            this._maxRadius = r || Infinity;
            if (this.scxmlDoc)
            {
                this.scxmlDoc.transitions.forEach(t => t.reroute());
            }
        }
    }
});

SSE.Editor.prototype.useSCXML = function(scxmlDoc) {
    this.scxmlDoc = scxmlDoc;
    this.observer = new MutationObserver(this.onDocChange.bind(this));
    this.observer.observe(scxmlDoc.root, {childList:true, attributes:true, subtree:true});

    Object.setPrototypeOf(SSE.State, Object.getPrototypeOf(scxmlDoc.root));
    Object.setPrototypeOf(SSE.Transition, Object.getPrototypeOf(scxmlDoc.transitions[0]));

    // Turn off the grid when setting the initial positions of items
    this.gridActive = false;
    scxmlDoc.states.forEach(this.addState.bind(this));
    scxmlDoc.transitions.forEach(this.addTransition.bind(this));
    this.gridActive = true;
};

SSE.Editor.prototype.addState = function(state) {
    // The root SCXML element does not get displayed visually
    if (state===this.scxmlDoc.root) return;

    Object.setPrototypeOf(state, SSE.State);

    const ego = state._sse = {
        editor   : this,
        shadow   : make('rect', {_dad:this.g.shadows, rx:state.cornerRadius, ry:state.cornerRadius}),
        main     : make('g', {_dad:this.g.content, transform:'translate(0,0)', 'class':'state'}),
    };

    ego.tx = ego.main.transform.baseVal.getItem(0);
    ego.rect  = make('rect', {_dad:ego.main, rx:state.cornerRadius, ry:state.cornerRadius});
    ego.label = make('text', {_dad:ego.main, _text:state.id});
    ego.enter = make('path', {_dad:ego.main, d:'M0,0', 'class':'enter'});
    ego.exit  = make('path', {_dad:ego.main, d:'M0,0', 'class':'exit'});
    this.makeDraggable(ego.main, state);

    if (!state.getAttributeNS(nvNS,'xywh')) {
        const [x,y,w,h] = state.parentNode.xywh || [0,0,2000,1000];
        state.xywh = [x+this.gridSize*2, y+this.gridSize*3, 120, 40];
    }

    // Force generation of default values and updating from DOM
    state.xywh = state.xywh;
    state.rgb = state.rgb;
    state.checkScripts();
    state.checkChildren();

    ego.main.addEventListener('mousedown', evt=>{
        evt.stopPropagation();
        this.select(evt, state);
    }, false);
};

SSE.Editor.prototype.addTransition = function(tran) {
    Object.setPrototypeOf(tran, SSE.Transition);
    const ego = tran._sse = {
        editor : this,
        main   : make('g', {_dad:this.g.transitions, 'class':'transition'}),
    };
    ego.catcher = make('path', {_dad:ego.main, d:'M0,0', 'class':'catcher'});
    ego.path    = make('path', {_dad:ego.main, d:'M0,0', 'class':'transition'});

    tran.checkCondition();
    tran.checkEvent();
    tran.checkTarget();
    tran.checkScripts();

    ego.main.addEventListener('mousedown', evt=>{
        evt.stopPropagation();
        this.select(evt, tran);
    }, false);

    tran.reroute();
};

SSE.Editor.prototype.makeDraggable = function(el, obj){
    el.addEventListener('mousedown',function(evt){
        // TODO: Transform from screen to SVG space for viewBox'd content

        const sandbox={};
        const startX=evt.clientX, startY=evt.clientY;
        let dragging=false;
        document.body.addEventListener('mousemove', onmove, false);
        function onmove(evt){
            evt.stopPropagation();
            if (!dragging && (dragging=true) && obj.startDragging) obj.startDragging(sandbox);
            if (obj.handleDrag) obj.handleDrag(evt.clientX-startX, evt.clientY-startY, sandbox);
        }
        document.body.addEventListener('mouseup',function(){
            document.body.removeEventListener('mousemove',onmove,false);
            if (obj.finishDragging) obj.finishDragging(sandbox);
        },false);
    },false);
}

SSE.Editor.prototype.select = function(evt, item){
    if (!evt.shiftKey)
    {
        this.selection.forEach(i => i.deselect());
        this.selection.length = 0;
    }
    if (item) {
        this.selection.push(item);
        item.select();
    }
}

SSE.Editor.prototype.snap = function(n){
    if (this.gridActive) {
        if (n.map) n=n.map(v=>Math.round(v/this.gridSize)*this.gridSize);
        else       n=Math.round(n/this.gridSize)*this.gridSize;
    }
    return n;
}

SSE.Editor.prototype.onDocChange = function(mutationList){
    mutationList.forEach(m => {
        switch(m.type) {
            case 'childList':
                let anyScripts = false;
                let anyStates  = false;
                m.removedNodes.forEach(n => {
                    if (!n.parentNode) n.deleteGraphics();
                    anyScripts |= n.nodeName==='script';
                    anyStates  |= /^(?:state|parallel|history)$/.test(n.nodeName);
                });

                m.addedNodes.forEach(n => {
                    switch(n.nodeName) {
                        case 'state':
                        case 'parallel':
                        case 'history':
                            if (n._sse) n.checkContainment();
                            else        this.addState(n);

                            n.parentNode.checkChildren();
                        break;

                        case 'transition':
                            if (!n._sse) this.addTransition(n);
                        break;

                        case 'script':
                            const parent = n.parentNode;
                            switch (parent.nodeName) {
                                case 'transition':
                                    parent.checkScripts();
                                break;
                                case 'onentry':
                                case 'onexit':
                                    parent.parentNode.checkScripts();
                                break;
                            }
                        break;

                        default:
                            console.log('Dunno what to do with added node', n);
                    }
                });

                if (anyScripts) this.scxmlDoc.states.forEach(ƒ('checkScripts'));
                if (anyStates)  this.scxmlDoc.states.forEach(ƒ('checkChildren'));
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
    cornerRadius:10,

    startDragging(sandbox){
        // Re-order this state to the top
        sandbox.starts = new Map([this, ...this.descendants].map(n => [n, n.xy]));
        for (const [n,xy] of sandbox.starts) {
            n._sse.main.parentNode.appendChild(n._sse.main);
        }
    },

    handleDrag(dx, dy, sandbox) {
        for (const [s,xy] of sandbox.starts) s.xy = [xy[0]+dx, xy[1]+dy];
        for (const [s,xy] of sandbox.starts) {
            s.transitions.forEach(ƒ('reroute'));
            s.incomingTransitions.forEach(ƒ('reroute'));
        }
    },

    select() {
        this._sse.main.classList.add('selected');
    },

    deselect() {
        this._sse.main.classList.remove('selected');
    },

    deleteGraphics() {
        this._sse.shadow.remove();
        this._sse.main.remove();
        delete this._sse;
    },

    updateAttribute(attrNS, attrName){
        const val = this.getAttributeNS(attrNS, attrName);
        const ego = this._sse;
        switch(attrName){
            case 'xywh':
                const o = 4;
                const r = this.cornerRadius-o;
                const [x,y,w,h] = val.split(/\s+/).map(Number);
                ego.tx.setTranslate(x, y);
                setAttributes(ego.shadow, {x:x, y:y});
                ego.enter.setAttribute('d', `M${o+r},${o} A${r},${r},0,0,0,${o},${o+r} L${o},${h-o-r} A${r},${r},0,0,0,${o+r},${h-o}`);
                ego.exit.setAttribute('d', `M${w-o-r},${o} A${r},${r},0,0,1,${w-o},${o+r} L${w-o},${h-o-r} A${r},${r},0,0,1,${w-o-r},${h-o}`);
                setAttributes(ego.rect,   {width:w, height:h});
                setAttributes(ego.shadow, {width:w, height:h});

                this.transitions.forEach(ƒ('reroute'));
                this.incomingTransitions.forEach(ƒ('reroute'));
                this.updateLabelPosition();
                this.checkContainment();
            break;

            case 'rgb':
                this._sse.rect.style.fill = 'rgb('+this.rgb.join()+')';
            break;

            case 'id':
                ego.label.textContent = val;
            break;
        }
    },

    checkContainment() {
        this._sse.main.classList.toggle('containmentError', !this.containedWithin(this.parentNode));
        this.states.forEach(ƒ('checkContainment'));
    },

    checkScripts() {
        if (!this._sse) return;
        this._sse.main.classList.toggle('enter', this.enterScripts.length);
        this._sse.main.classList.toggle('exit',  this.exitScripts.length);
    },

    checkChildren() {
        if (!this._sse) return;
        this._sse.main.classList.toggle('parent', this.states.length);
        this.updateLabelPosition()
    },

    updateLabelPosition() {
        const [x,y,w,h] = this.xywh;
        const top = this.states.length>0 ? 15 : h/2;
        setAttributes(this._sse.label, {x:w/2, y:top});
    },

    containedWithin(s2) {
        if (s2.isSCXML) return true;
        const d1=this.xywh, d2=s2.xywh;
        return (d1[0]>=d2[0] && d1[1]>=d2[1] && (d1[0]+d1[2])<=(d2[0]+d2[2]) && (d1[1]+d1[3])<=(d2[1]+d2[3]));
    },
},{
    x: {
        get(){ return this.xywh[0] },
        set(x){ const xywh=this.xywh; xywh[0]=this._sse.editor.snap(x); this.xywh=xywh }
    },
    y: {
        get(){ return this.xywh[1] },
        set(y){ const xywh=this.xywh; xywh[1]=this._sse.editor.snap(y); this.xywh=xywh }
    },
    w: {
        get(){ return this.xywh[2] },
        set(w){ const xywh=this.xywh; xywh[2]=this._sse.editor.snap(w); this.xywh=xywh }
    },
    h: {
        get(){ return this.xywh[3] },
        set(h){ const xywh=this.xywh; xywh[3]=this._sse.editor.snap(h); this.xywh=xywh }
    },
    xy: {
        get(){ return this.xywh.slice(0,2) },
        set(xy){ const xywh=this.xywh; [xywh[0], xywh[1]]=this._sse.editor.snap(xy); this.xywh=xywh }
    },
    wh: {
        get(){ return this.xywh.slice(2) },
        set(wh){ const xywh=this.xywh; [xywh[2], xywh[3]]=this._sse.editor.snap(wh); this.xywh=xywh }
    },
    xywh: {
        get(){
            let xywh=this.getAttributeNS(nvNS, 'xywh');
            if (xywh) return xywh.split(/\s+/).map(Number);
            else return [0,0,120,40];
        },
        set(xywh){ this.setAttributeNS(nvNS, 'xywh', xywh.join(' ')) }
    },

    r: {
        get(){ return this.rgb[0] },
        set(r){ const rgb=this.rgb; rgb[0]=r; this.rgb=rgb }
    },
    g: {
        get(){ return this.rgb[1] },
        set(g){ const rgb=this.rgb; rgb[1]=g; this.rgb=rgb }
    },
    b: {
        get(){ return this.rgb[2] },
        set(b){ const rgb=this.rgb; rgb[2]=b; this.rgb=rgb }
    },
    rgb: {
        get(){
            const rgb = this.getAttributeNS(nvNS, 'rgb') || 'FFFFFF';
            return rgb.match(/[\da-f]{2}/gi).map(s=>parseInt(s,16));
        },
        set(rgb){ this.setAttributeNS(nvNS, 'rgb', rgb.map(toHex255).join('')) }
    },
});

// ****************************************************************************
// ****************************************************************************
// ****************************************************************************

SSE.Transition = Object.defineProperties({
    reroute(){
        const pts = [];
        pts.push(this.sourceXY);
        if (this.targetId) pts.push(this.targetXY);
        const path = svgPathFromAnchors(this.anchors, this.radius);
        this._sse.path.setAttribute('d', path);
        this._sse.catcher.setAttribute('d', path);
    },

    select() {
        const main = this._sse.main;
        main.parentNode.appendChild(main);
        main.classList.add('selected');
    },

    deselect() {
        this._sse.main.classList.remove('selected');
    },

    deleteGraphics() {
        this._sse.main.remove();
        delete this._sse;
    },

    bestAnchors() {
        const source=this.source, target=this.target;
        const [sx,sy,sw,sh] = source.xywh;
        if (!target) return [anchorOnState(source, 'S', sw/2)];
        const [tx,ty,tw,th] = target.xywh;
        const [sr,sb,tr,tb] = [sx+sw, sy+sh, tx+tw, ty+th];
        if (source.containedWithin(target)) {
            return [
                anchorOnState(source, 'E', sh/2, true),
                anchorOnState(target, 'E', th/2, false),
            ]
        } else if (target.containedWithin(source)) {
            return [
                anchorOnState(source, 'W', sh/2, true),
                anchorOnState(target, 'W', th/2, false),
            ]
        } else {
            const gapN = sy-tb;
            const gapS = ty-sb;
            const gapE = tx-sr;
            const gapW = sx-tr;
            const biggest = Math.max(gapE, gapS, gapW, gapN);
            const avgY = (Math.max(sy,ty)+Math.min(sb,tb))/2;
            const avgX = (Math.max(sx,tx)+Math.min(sr,tr))/2;
            const result = [];
            if (biggest===gapE) {
                result.push(anchorOnState(source, 'E', avgY-sy-5, true));
                if      (avgY<ty) result.push(anchorOnState(target, 'N', 0, false));
                else if (avgY>tb) result.push(anchorOnState(target, 'S', 0, false));
                else              result.push(anchorOnState(target, 'W', avgY-ty-5, false));
            } else if (biggest===gapS) {
                result.push(anchorOnState(source, 'S', avgX-sx-5, true));
                if      (avgX<tx) result.push(anchorOnState(target, 'W', 0, false));
                else if (avgX>tr) result.push(anchorOnState(target, 'E', 0, false));
                else              result.push(anchorOnState(target, 'N', avgX-tx-5, false));
            } else if (biggest===gapW) {
                result.push(anchorOnState(source, 'W', avgY-sy+5, true));
                if      (avgY<ty) result.push(anchorOnState(target, 'N', tw, false));
                else if (avgY>tb) result.push(anchorOnState(target, 'S', tw, false));
                else              result.push(anchorOnState(target, 'E', avgY-ty+5, false));
            } else if (biggest===gapN) {
                result.push(anchorOnState(source, 'N', avgX-sx+5, true));
                if      (avgX<tx) result.push(anchorOnState(target, 'W', th, false));
                else if (avgX>tr) result.push(anchorOnState(target, 'E', th, false));
                else              result.push(anchorOnState(target, 'S', avgX-tx+5, false));
            }
            return result;
        }
    },

    checkCondition() {
        this._sse.main.classList.toggle('conditional',   this.condition);
        this._sse.main.classList.toggle('conditionless', !this.condition);
    },

    checkEvent() {
        this._sse.main.classList.toggle('event',     this.event);
        this._sse.main.classList.toggle('eventless', !this.event);
    },

    checkTarget() {
        this._sse.main.classList.toggle('targeted',   this.targetId);
        this._sse.main.classList.toggle('targetless', !this.targetId);
    },

    checkScripts() {
        this._sse.main.classList.toggle('actions',    this.scripts.length);
        this._sse.main.classList.toggle('actionless', !this.scripts.length);
    },

    updateAttribute(attrNS, attrName){
        const val = this.getAttributeNS(attrNS, attrName);
        const ego = this._sse;
        switch(attrName){
            case 'pts':
            case 'radius':
                this.reroute();
            break;
            case 'target':
                this.checkTarget();
                this.reroute();
            break;
        }
    },
},{
    radius:{
        get(){
            // This (intentionally) prevents completely square corners by ignoring values of 0
            return this.getAttributeNS(nvNS, 'radius')*1 || this._sse.editor.maxRadius || null;
        },
        set(r)
        {
            // This (intentionally) prevents completely square corners by ignoring values of 0
            if (r)
            {
                this.setAttributeNS(nvNS, 'radius', r*1);
            }
            else
            {
                this.removeAttributeNS(nvNS, 'radius');
            }
        }
    },

    anchors:{
        get(){
            const pts = this.pts;
            if (!this.pts) return this.bestAnchors();
            const anchors = [],
                  regex   = /([NSEWXY])\s*(\S+)/g;
            let match;
            while (match=regex.exec(pts)) {
                const [,direction,offset] = match;
                switch (direction) {
                    case 'X': anchors.push({x:offset*1, horiz:false}); break;
                    case 'Y': anchors.push({y:offset*1, horiz:true }); break;
                    default:
                        const state = anchors.length ? this.target : this.parentNode;
                        const anchor = anchorOnState(state, direction, offset*1, state===this.parentNode);
                        if (anchor) anchors.push(anchor);
                }
            }
            return anchors;
        }
    },

    pts:{
        get()
        {
            return this.getAttributeNS(nvNS, 'pts');
        },
        set(str)
        {
            this.setAttributeNS(nvNS, 'pts', str);
        }
    }
});

// state: a state node
// side: 'N', 'S', 'E', 'W'
// offset: a distance along that edge
function anchorOnState(state, side, offset, startState) {
    if (!state) return;
    const rad = state.cornerRadius;
    let [x,y,w,h] = state.xywh;
    const [l,t,r,b] = [x+rad, y+rad, x+w-rad, y+h-rad];
    const anchor = {x, y, horiz:true};
    if (startState!==undefined) anchor.start=startState;
    if (side==='N' || side==='S') {
        anchor.horiz = false;
        anchor.x += offset;
        if (anchor.x<l) anchor.x=l;
        else if (anchor.x>r) anchor.x=r;
        if (side==='S') anchor.y+=h;
    }
    if (side==='W' || side==='E') {
        anchor.y += offset;
        if (anchor.y<t) anchor.y=t;
        else if (anchor.y>b) anchor.y=b;
        if (side==='E') anchor.x+=w;
    }
    return anchor;
}

function svgPathFromAnchors(anchors, maxRadius=Infinity)
{
    if (anchors.length===1) {
        const [x,y] = [anchors[0].x,anchors[0].y];
        return `M${x},${y}M${x-5},${y+0.01}A5,5,0,1,0,${x-5},${y-0.01}M${x},${y}`;
    }
    if (!maxRadius)
    {
        maxRadius = Infinity;
    }

    // Calculate intersection points
    let prevPoint = anchors[0], nextPoint;
    const pts = [prevPoint];
    for (let i=1; i<anchors.length; ++i) {
        nextPoint = Object.assign({}, anchors[i]);
        // Interject an anchor of opposite orientation between two sequential anchors with the same orientation
        if (nextPoint.horiz===prevPoint.horiz) {
            const mainAxis = prevPoint.horiz ? 'x' : 'y',
                  crosAxis = prevPoint.horiz ? 'y' : 'x';
            let nextMain = nextPoint[mainAxis];
            for (let j=i; nextMain===undefined; ++j) nextMain = anchors[j][mainAxis];
            nextPoint = {
                [mainAxis] : (prevPoint[mainAxis]+nextMain)/2,
                [crosAxis] : prevPoint[crosAxis],
                horiz      : !prevPoint.horiz
            };
            // Since we generated a new anchor, retry the next real anchor next loop
            i--;
        } else {
            if (prevPoint.horiz) nextPoint.y = prevPoint.y;
            else                 nextPoint.x = prevPoint.x;
        }
        pts.push(nextPoint);
        prevPoint.distanceToNext = Math.hypot(nextPoint.x-prevPoint.x, nextPoint.y-prevPoint.y);
        prevPoint = nextPoint;
    }
    nextPoint = anchors[anchors.length-1];
    prevPoint.distanceToNext = Math.hypot(nextPoint.x-prevPoint.x, nextPoint.y-prevPoint.y);
    pts.push(nextPoint);

    // Crawl along the point triplets, calculating curves
    let lastCmd = {c:'M', x:pts[0].x, y:pts[0].y}
    let cmds = [lastCmd];
    for (let i=1; i<pts.length-1; ++i) {
        const [a,b,c] = [pts[i-1], pts[i], pts[i+1]];
        const radius = Math.min(a.distanceToNext/2, b.distanceToNext/2, maxRadius);

        let x=a.horiz ? (a.x<b.x ? b.x-radius : b.x+radius) : a.x;
        let y=a.horiz ? a.y : (a.y<b.y ? b.y-radius : b.y+radius);
        if (x!==lastCmd.x || y!==lastCmd.y) {
            lastCmd = {c:'L', x:x, y:y}
            cmds.push(lastCmd);
        }

        x = b.x + (b.horiz ? (c.x>b.x ? radius : -radius) : 0);
        y = b.y + (b.horiz ? 0 : (c.y>b.y ? radius : -radius));

        if (x===lastCmd.x || y===lastCmd.y) lastCmd = {c:'L', x:x, y:y};
        else                                lastCmd = {c:'A', x1:b.x, y1:b.y, x:x, y:y, r:radius};
        cmds.push(lastCmd);
    }
    const last = pts[pts.length-1];
    cmds.push({c:'L', x:last.x, y:last.y});

    let x,y;
    return cmds.map(cmd => {
        let result;
        switch (cmd.c) {
            case 'M':
            case 'L':
                result = `${cmd.c}${cmd.x},${cmd.y}`;
            break;
            case 'A':
                const angle = (cmd.y1-y)*(cmd.x-cmd.x1)-(cmd.y-cmd.y1)*(cmd.x1-x);
                result = `A${cmd.r},${cmd.r},0,0,${angle<0?1:0},${cmd.x},${cmd.y}`;
            break;
        }
        x = cmd.x;
        y = cmd.y;
        return result;
    }).join('');
}

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

function toHex255(n) {
    return (Math.round(n)%256).toString(16).padStart(2,'0');
}

export default SSE.Editor;
