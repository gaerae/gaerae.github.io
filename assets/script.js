/* https://github.com/zengabor/zenscroll v4.0.2 */
!function(t,e){"function"==typeof define&&define.amd?define([],e()):"object"==typeof module&&module.exports?module.exports=e():function n(){document&&document.body?t.zenscroll=e():setTimeout(n,9)}()}(this,function(){"use strict";var t=function(t){return t&&"getComputedStyle"in window&&"smooth"===window.getComputedStyle(t)["scroll-behavior"]};if("undefined"==typeof window||!("document"in window))return{};var e=function(e,n,o){n=n||999,o||0===o||(o=9);var i,r=function(t){i=t},u=function(){clearTimeout(i),r(0)},c=function(t){return Math.max(0,e.getTopOf(t)-o)},a=function(o,i,c){if(u(),0===i||i&&i<0||t(e.body))e.toY(o),c&&c();else{var a=e.getY(),f=Math.max(0,o)-a,s=(new Date).getTime();i=i||Math.min(Math.abs(f),n),function t(){r(setTimeout(function(){var n=Math.min(1,((new Date).getTime()-s)/i),o=Math.max(0,Math.floor(a+f*(n<.5?2*n*n:n*(4-2*n)-1)));e.toY(o),n<1&&e.getHeight()+o<e.body.scrollHeight?t():(setTimeout(u,99),c&&c())},9))}()}},f=function(t,e,n){a(c(t),e,n)},s=function(t,n,i){var r=t.getBoundingClientRect().height,u=e.getTopOf(t)+r,s=e.getHeight(),l=e.getY(),d=l+s;c(t)<l||r+o>s?f(t,n,i):u+o>d?a(u-s+o,n,i):i&&i()},l=function(t,n,o,i){a(Math.max(0,e.getTopOf(t)-e.getHeight()/2+(o||t.getBoundingClientRect().height/2)),n,i)};return{setup:function(t,e){return(0===t||t)&&(n=t),(0===e||e)&&(o=e),{defaultDuration:n,edgeOffset:o}},to:f,toY:a,intoView:s,center:l,stop:u,moving:function(){return!!i},getY:e.getY,getTopOf:e.getTopOf}},n=document.documentElement,o=function(){return window.scrollY||n.scrollTop},i=e({body:document.scrollingElement||document.body,toY:function(t){window.scrollTo(0,t)},getY:o,getHeight:function(){return window.innerHeight||n.clientHeight},getTopOf:function(t){return t.getBoundingClientRect().top+o()-n.offsetTop}});if(i.createScroller=function(t,o,i){return e({body:t,toY:function(e){t.scrollTop=e},getY:function(){return t.scrollTop},getHeight:function(){return Math.min(t.clientHeight,window.innerHeight||n.clientHeight)},getTopOf:function(t){return t.offsetTop}},o,i)},"addEventListener"in window&&!window.noZensmooth&&!t(document.body)){var r="history"in window&&"pushState"in history,u=r&&"scrollRestoration"in history;u&&(history.scrollRestoration="auto"),window.addEventListener("load",function(){u&&(setTimeout(function(){history.scrollRestoration="manual"},9),window.addEventListener("popstate",function(t){t.state&&"zenscrollY"in t.state&&i.toY(t.state.zenscrollY)},!1)),window.location.hash&&setTimeout(function(){var t=i.setup().edgeOffset;if(t){var e=document.getElementById(window.location.href.split("#")[1]);if(e){var n=Math.max(0,i.getTopOf(e)-t),o=i.getY()-n;0<=o&&o<9&&window.scrollTo(0,n)}}},9)},!1);var c=new RegExp("(^|\\s)noZensmooth(\\s|$)");window.addEventListener("click",function(t){for(var e=t.target;e&&"A"!==e.tagName;)e=e.parentNode;if(!(!e||1!==t.which||t.shiftKey||t.metaKey||t.ctrlKey||t.altKey)){if(u){var n=history.state&&"object"==typeof history.state?history.state:{};n.zenscrollY=i.getY();try{history.replaceState(n,"")}catch(t){}}var o=e.getAttribute("href")||"";if(0===o.indexOf("#")&&!c.test(e.className)){var a=0,f=document.getElementById(o.substring(1));if("#"!==o){if(!f)return;a=i.getTopOf(f)}t.preventDefault();var s=function(){window.location=o},l=i.setup().edgeOffset;l&&(a=Math.max(0,a-l),r&&(s=function(){history.pushState({},"",o)})),i.toY(a,null,s)}}},!1)}return i});

/************
Loader
*************/
window.addEventListener("load", function(){
  document.getElementById("loader").style.display = 'none';
});

/************
Light Box
*************/
function hasClass(element, cls) {
  return (' ' + element.className + ' ').indexOf(' ' + cls + ' ') > -1;
}
var opened = false;
function aProjectsLightBox(event){
  var close = this.querySelector(".closeIcon");
  var aProjects = this;
  var LB = aProjects.querySelector(".aProjectsLightBox");
  if(!opened){
    LB.classList.add("expanded");
    document.body.classList.add("aProjectsLightBoxOpened");
    if(hasClass(aProjects, "notOpened")){
      setTimeout(function(){
        LB.querySelector(".aProjectsLightBoxCon").classList.add("show");
      }, 300);
    }
    opened = true;
  }else if (close === event.target || close.contains(event.target)) {
    aProjects.querySelector(".aProjectsLightBox").classList.remove("expanded");
    LB.querySelector(".aProjectsLightBoxCon").classList.remove("show");
    document.body.classList.remove("aProjectsLightBoxOpened");
    opened = false;
  }
}
var elements = document.querySelectorAll(".aProjects");
for(var i = 0; i < elements.length; i++){
  elements[i].addEventListener("click", aProjectsLightBox);
}

/************
 Canvas Container
*************/
var canvasContainer = document.getElementById("canvasContainer");
var canvas =  document.getElementById("canvas")
var c = canvas.getContext("2d");

canvas.width = canvasContainer.offsetWidth;
canvas.height = canvasContainer.offsetHeight;
var canWidth = canvasContainer.offsetWidth;
var canHeight = canvasContainer.offsetHeight;

window.addEventListener("resize", function(){
  canvas.width = canvasContainer.offsetWidth;
  canvas.height = canvasContainer.offsetHeight;
  canWidth = canvasContainer.offsetWidth;
  canHeight = canvasContainer.offsetHeight;
});

var canMouse = {
  x: undefined,
  y: undefined,
}
canvas.addEventListener("mousemove", function(event){
  canMouse.x = event.offsetX;
  canMouse.y = event.offsetY;
});
var skills = [
  "Linux", "Docker", "Kubernetes",
  "PostgreSQL", "MySql",
  "Bash", "Python", "PHP", "Go",
  "JavaScript", "Node.js", "Vue.js",
  "Architecture","Curation","Leadership","DevRel", "DevOps"
];

var canMouse = {
  x: undefined,
  y: undefined,
}
var theElementBeingHovered = {
  is: false,
  x: undefined,
  y: undefined,
  numOfUnH: 0
}

var FontSize = 10;
var MaxFontSize = 24;
var maxR = 50;
var radius = 20;
var growthSpeed = 4;
var fGrowthSpeed = (MaxFontSize-FontSize)/((maxR - radius)/growthSpeed);
var moveSpeed = 1;
var hFlag = false;
var strokeColor = "#282b33";
var fontColor = "#474c5a";
var colors = [
  "#61d090",
  "#61d0cb",
  "#ef6262",
  "#6c75e2",
  "#dbe26c",
];

function Circle(x, y, dx, dy, radius, txt){
  this.x = x;
  this.y = y;
  this.dx = dx;
  this.dy = dy;
  this.radius = radius;
  this.txt = txt;
  this.FontSize = FontSize;
  this.strokeStyle = strokeColor;
  this.fontColor = fontColor;

  this.draw = function(){
    c.fillStyle = "#151619";
    c.beginPath();
    c.arc(this.x, this.y,this.radius, Math.PI * 2, false);
    c.strokeStyle = this.strokeStyle;
    c.stroke();
    c.lineWidth = 4;

    //draw text
    c.closePath();
    c.fill();
    c.fillStyle = this.fontColor;
    var font = "bold " + this.FontSize +"px sans-serif";
    c.font = font;
    var text = this.txt;
    var width = c.measureText(text).width;
    var height = c.measureText("w").width;
    c.fillText(text, this.x - (width/2) ,this.y + (height/2));
  }

  this.update = function(){

    if(this.x >= canWidth - this.radius || this.x <= this.radius){
      this.dx *= -1;
    }

    if(this.y >= canHeight - this.radius || this.y <= this.radius){
      this.dy *= -1;
    }
    this.x += this.dx;
    this.y += this.dy;

    //interaction
    var mouseIsOnTheCircle = Math.abs(canMouse.x - this.x) < this.radius
      && Math.abs(canMouse.y  - this.y) < this.radius;

    if(mouseIsOnTheCircle
      && this.radius < maxR){
      this.radius += growthSpeed;
    } else if (this.radius > radius && !mouseIsOnTheCircle){
      this.radius -= growthSpeed;
    }
    if(mouseIsOnTheCircle
      && this.FontSize < MaxFontSize){
      this.FontSize += fGrowthSpeed;
    }else if(!mouseIsOnTheCircle
      && this.FontSize > FontSize){
      this.FontSize -= fGrowthSpeed;
    }
    if(mouseIsOnTheCircle){
      theElementBeingHovered.is = true;
      theElementBeingHovered.x = this.x;
      theElementBeingHovered.y = this.y;
      this.strokeStyle = "#ffffff";
      this.fontColor = "#ffffff";
    }else{
      theElementBeingHovered.numOfUnH++;
      this.strokeStyle = strokeColor;
      this.fontColor = fontColor;
    }
    //console.log(Math.abs(canMouse.y  - this.y) < this.radius);
    this.draw();
  }
}

function Hcircle(x, y, dx, dy, radius){
  this.x = x;
  this.y = y;
  this.dx = dx;
  this.dy = dy;
  this.radius = radius;
  this.color = colors[Math.floor(Math.random()*colors.length)];

  this.draw = function(){
    c.beginPath();
    c.arc(this.x, this.y,this.radius, Math.PI * 2, false);
    c.strokeStyle = this.color;
    c.stroke();
    c.lineWidth = 6;
  }
  this.hover = function(){
    if(this.x >= canWidth - this.radius || this.x <= this.radius){
      this.dx *= -1;
    }

    if(this.y >= canHeight - this.radius || this.y <= this.radius){
      this.dy *= -1;
    }
    this.x += this.dx;
    this.y += this.dy;

    //interaction
    if(this.radius >= 1){
      this.radius -= 1;
    }
    this.draw();
  }
}

var BGgrowthSpeed = 1;
var BGmaxR = 12;
var BGmoveSpeed = .7;
function BGcircle(x, y, dx, dy, radius, bg){
  this.x = x;
  this.y = y;
  this.dx = dx;
  this.dy = dy;
  this.radius = radius;
  this.minR = radius;
  this.bg = bg;

  this.draw = function(){
    c.fillStyle = this.bg;
    //c.globalAlpha = ".5";
    c.beginPath();
    c.arc(this.x, this.y,this.radius, Math.PI * 2, false);
    c.fill();
  }

  this.update = function(){

    if(this.x >= canWidth - this.radius || this.x <= this.radius){
      this.dx *= -1;
    }
    if(this.y >= canHeight - this.radius || this.y <= this.radius){
      this.dy *= -1;
    }
    this.x += this.dx;
    this.y += this.dy;


    this.draw();
  }
}



var CircleArray = [];

for (var i = 0; i < skills.length; i++) {
  var x = radius + Math.random()*(canWidth-2*radius);
  var y = radius + Math.random()*(canHeight-2*radius);
  var dx = ((Math.random()-.5)> 0? 1 : -1)* Math.random()*moveSpeed;
  var dy = ((Math.random()-.5)> 0? 1 : -1)*Math.random()*moveSpeed;
  CircleArray.push(new Circle(x, y, dx, dy, radius, skills[i]));
}

var Hcircles = [];


for (var i = 0; i < 10; i++) {
  var radius = 100 + Math.random()*20;
  var x = radius + Math.random()*(canWidth-2*radius);
  var y = radius + Math.random()*(canHeight-2*radius);
  var dx = ((Math.random-.5)> 0? 1 : -1)*2 + (Math.random() - .5)*moveSpeed;
  var dy = ((Math.random-.5)> 0? 1 : -1)*2 + (Math.random() - .5)*moveSpeed;
  Hcircles.push(new Hcircle(x, y, dx, dy, radius));
}


var BGcircleArray = [];

for (var i = 0; i < 5; i++) {
  var radius = 3 +Math.random()*3;
  var x = radius + Math.random()*(canWidth-2*radius);
  var y = radius + Math.random()*(canHeight-2*radius);
  var dx = ((Math.random()-.5)> 0? 1 : -1)* Math.random()*BGmoveSpeed;
  var dy = ((Math.random()-.5)> 0? 1 : -1)*Math.random()*BGmoveSpeed;
  var bg = colors[Math.floor(Math.random()*colors.length)];
  BGcircleArray.push(new BGcircle(x, y, dx, dy, radius, bg));
}

theElementBeingHovered.numOfUnH = CircleArray.length;
function animate(){
  requestAnimationFrame(animate);
  c.clearRect(0, 0, canWidth,canHeight);
  for(var i = 0; i < BGcircleArray.length; i++){
    BGcircleArray[i].update();
  }
  if(theElementBeingHovered.numOfUnH == CircleArray.length){
    theElementBeingHovered.is = false;
    theElementBeingHovered.x = undefined;
    theElementBeingHovered.y = undefined;
    hFlag = false;
  }
  theElementBeingHovered.numOfUnH = 0;

  if(theElementBeingHovered.is){
    if(!hFlag){
      for(var i = 0; i < Hcircles.length; i++){

        var radius = 50 + Math.random()*20;
        var dx = ((Math.random-.5)> 0? 1 : -1)*2 + (Math.random() - .5)*20;
        var dy = ((Math.random-.5)> 0? 1 : -1)*2 + (Math.random() - .5)*20;
        Hcircles[i].x = theElementBeingHovered.x;
        Hcircles[i].y = theElementBeingHovered.y;
        Hcircles[i].dx = dx;
        Hcircles[i].dy = dy;
        Hcircles[i].radius = radius;
        Hcircles[i].hover();
      }
      hFlag = true;
    }
    for(var i = 0; i < Hcircles.length; i++){
      Hcircles[i].hover();
    }
  }
  for(var i = 0; i < CircleArray.length; i++){
    CircleArray[i].update();
  }
}
animate();

/************
 Message
 *************/
console.info(
    '%c [~/gaerae.com $] %c curl https://github.com/gaerae/gaerae.github.io',
    'font-family: "Fira Code", monospace; padding: 2px 0; background-color: #2E8CCF; color: #000000;',
    'color: #000000;'
);
/*
const xmlHttp = new XMLHttpRequest();
xmlHttp.open('GET', 'https://api.ipify.org?format=text', false);
xmlHttp.send(null);
document.querySelector('#messageIP').innerHTML = xmlHttp.responseText;
*/