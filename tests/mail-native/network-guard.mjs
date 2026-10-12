// Preload before dependencies. Permit only the fixed ephemeral PostgreSQL
// socket; provider HTTP, external sockets and DNS never reach the network.
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import dgram from 'node:dgram';
import {syncBuiltinESMExports} from 'node:module';
const denied=()=>{throw Error('Fixture outbound network denied');};
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  const first=Array.isArray(args[0])?args[0][0]:args[0];
  const options=first&&typeof first==='object'?first:{port:first,host:typeof args[1]==='string'?args[1]:'localhost'};
  if(options.path||options.host!=='127.0.0.1'||Number(options.port)!==55432)denied();
  return connect.apply(this,args);
};
for(const module of [http,https]){module.request=denied;module.get=denied;}
globalThis.fetch=async()=>denied();
dns.lookup=function(host,...args){
  if(host!=='127.0.0.1')denied();
  const callback=args.at(-1),options=args[0];
  if(typeof callback!=='function')denied();
  process.nextTick(()=>options?.all?callback(null,[{address:'127.0.0.1',family:4}]):callback(null,'127.0.0.1',4));
};
for(const name of Object.keys(dns))if(name.startsWith('resolve')||['lookupService','reverse'].includes(name))dns[name]=denied;
for(const Type of [dns.Resolver,dns.promises.Resolver]){
  for(const name of Object.getOwnPropertyNames(Type.prototype))if(name!=='constructor'&&typeof Type.prototype[name]==='function')Type.prototype[name]=denied;
}
dns.Resolver=class{constructor(){denied();}};
dns.promises.Resolver=class{constructor(){denied();}};
for(const name of Object.keys(dns.promises))if(name!=='Resolver'&&typeof dns.promises[name]==='function')dns.promises[name]=async()=>denied();
for(const name of ['bind','connect','send','addMembership','addSourceSpecificMembership'])dgram.Socket.prototype[name]=denied;
dgram.createSocket=denied;
dgram.Socket=class{constructor(){denied();}};
syncBuiltinESMExports();
