  
/**
 * Copyright 2020 Bart Butenaers & Johannes Kropf
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/
 module.exports = function(RED) {
    var settings = RED.settings;
    const { exec } = require("child_process");
    const { execSync } = require("child_process");
    const { spawn } = require("child_process");
    const fs = require("fs");
    
    function Voice2JsonSpeechToTextNode(config) {
        RED.nodes.createNode(this, config);
        this.inputField  = config.inputField;
        this.controlField = config.controlField;
        this.outputField = config.outputField;
        this.profilePath = "";
        this.filePath = "";
        this.inputMsg = null;
        this.statusTimer = false;
        this.statusTimer2 = false;
        this.processingNow = false;
        this.autoStart = config.autoStart;
        this.msgObj = {};
        this.fileId = "";
        this.shm = true;
        var node = this;
        
        function node_status(state1 = [], timeout = 0, state2 = []){
            
            if (state1.length !== 0) {
                node.status({fill:state1[1],shape:state1[2],text:state1[0]});
            } else {
                node.status({});
            }
            
            if (node.statusTimer !== false) {
                clearTimeout(node.statusTimer);
                node.statusTimer = false;
            }
            
            if (timeout !== 0) {
                node.statusTimer = setTimeout(() => {
                
                    if (state2.length !== 0) {
                        node.status({fill:state2[1],shape:state2[2],text:state2[0]});
                    } else {
                        node.status({});
                    }
                    
                    node.statusTimer = false;
                    
                },timeout);
            }
            
        }
        
        function checkWav(filePath) {
            
            let reasons = "";
            try {
                const fileInfo = execSync("file " + filePath).toString();
            } catch (error) {
                node.warn("couldnt check file for properties, continuing anyway. We recommend installing file (sudo apt-get install file) if you want input files to be validated before processing.)");
                return true;
            }
            const fileInfo = execSync("file " + filePath).toString();
            if (!fileInfo.match(/WAVE audio/g)) { reasons += "not a wav file\n"; }
            if (!fileInfo.match(/16 bit/g)) { reasons += "wrong bit depth: should be 16 bit\n"; }
            if (!fileInfo.match(/16000 Hz/g)) { reasons += "wrong sample rate: should be 16000 Hz\n"; }
            if (!fileInfo.match(/mono/g)) { reasons += "not mono: audio should only have 1 channel\n"; }
            if (reasons.length !== 0) { 
                node.error("input audio not in the right format:\n" + reasons);
                (node.transcribeWav) ? node_status(["error","red","dot"],1500,["running","blue","ring"]) : node_status(["error","red","dot"]);
                return false;
            } else {
                return true;
            }
            
        }
        
        function spawnTranscribe(){
            try{
                node.transcribeWav = spawn("voice2json",["--profile",node.profilePath,"transcribe-wav","--stdin-file"],{detached:true});
            } 
            catch (error) {
                node_status(["error strating","red","ring"]);
                node.error(error);
                return;
            }
            
            node.warn("started");
            node_status(["running","blue","ring"]);
            
            node.transcribeWav.stderr.on('data', (data)=>{
                node.error("stderr: " + data.toString());
                if(node.transcribeWav){
                    node_status(["error","red","dot"],1500,["running","blue","ring"]);
                } else {
                    node_status(["error","red","dot"]);
                }
                return;
            });
            
            node.transcribeWav.on('close', function (code,signal) {
                node.processingNow = false;
                delete node.transcribeWav;
                node.warn("stopped");
                node_status(["stopped","grey","ring"]);
                return;
            });
            
            node.transcribeWav.stdout.on('data', (data)=>{
            
                node.processingNow = false;
                node.transcription = data.toString();
                
                try {
                    node.outputValue = JSON.parse(node.transcription);
                }
                catch(error) {
                    node.error("Error parsing json output : " + error.message);
                    if(node.transcribeWav){
                        node_status(["error parsing json","red","dot"],1500,["running","blue","ring"]);
                    } else {
                        node_status(["error parsing json","red","dot"]);
                    }
                    return;
                }
                
                try {
                    // Set the converted value in the specified message field (of the original input message)
                    RED.util.setMessageProperty(node.msgObj, node.outputField, node.outputValue, true);
                } catch(err) {
                    node.error("Error setting value in msg." + node.outputField + " : " + err.message);
                    if(node.transcribeWav){
                        node_status(["error","red","dot"],1500,["running","blue","ring"]);
                    } else {
                        node_status(["error","red","dot"]);
                    }
                    return;
                }
            
                node.send(node.msgObj);
                if(node.transcribeWav){
                    node_status(["success","green","dot"],1500,["running","blue","ring"]);
                } else {
                    node_status(["success","green","dot"],1500);
                }
                return;
            });
            return;
            
        }
        
        function saveBufferWrite(){
            
            node_status(["processing...","blue","dot"]);
            
            if (node.shm) {
                node.filePath = "/dev/shm/stt" + node.fileId + ".wav";
            } else {
                node.filePath = "/tmp/stt" + node.fileId + ".wav";
            }
            
            try {
                fs.writeFileSync(node.filePath,node.inputMsg);
            }
            catch (error){
                node.error("error saving tmp: " + err.message);
                if(node.transcribeWav){
                    node_status(["couldn't save buffer","red","dot"],1500,["running","blue","ring"]);
                } else {
                    node_status(["couldn't save buffer","red","dot"]);
                }
                return;
            }
            
            if(!checkWav(node.filePath)) { return; }
            
            node.processingNow = true;
            node.filePath += "\n";
            try {
                node.transcribeWav.stdin.write(node.filePath);
            }
            catch (error){
                node.error("couldn't write to stdin: " + error);
                node.processingNow = false;
                if(node.transcribeWav){
                    node_status(["error","red","dot"],1500,["running","blue","ring"]);
                } else {
                    node_status(["error","red","dot"]);
                }
            }  
            return;
        }
         
        function writeStdin(){
            
            node_status(["processing...","blue","dot"]);
            
            try {
                // Get the file path from the specified message field
                node.filePath = node.inputMsg;
            } 
            catch(err) {
                node.error("Error getting file path from msg." + node.inputField + " : " + err.message);
                if(node.transcribeWav){
                    node_status(["file path error","red","dot"],1500,["running","blue","ring"]);
                } else {
                    node_status(["file path error","red","dot"]);
                }
                return;
            }
                
            if (!node.filePath || node.filePath === "" || typeof node.filePath !== 'string') {
                node.error("The msg." + node.inputField + " should contain a file path");
                if(node.transcribeWav){
                    node_status(["file path error","red","dot"],1500,["running","blue","ring"]);
                } else {
                    node_status(["file path error","red","dot"]);
                }
                return;
            }

            if (!fs.existsSync(node.filePath)){
                node.error("The file path does not exist");
                if(node.transcribeWav){
                    node_status(["file path error","red","dot"],1500,["running","blue","ring"]);
                } else {
                    node_status(["file path error","red","dot"]);
                }
                return;
            }
            
            if(!checkWav(node.filePath)) { return; }
            
            node.processingNow = true;
            node.filePath += "\n";
            try {
                node.transcribeWav.stdin.write(node.filePath);
            }
            catch (error){
                node.error("couldn't write to stdin: " + error);
                node.processingNow = false;
                if(node.transcribeWav){
                    node_status(["file path error","red","dot"],1500,["running","blue","ring"]);
                } else {
                    node_status(["file path error","red","dot"]);
                }
            }
            return;
            
        }
        
        // Retrieve the config node
        node.voice2JsonConfig = RED.nodes.getNode(config.voice2JsonConfig);
        node_status(["not started","grey","ring"]);
        
        if (node.voice2JsonConfig) {
            // Use the profile path which has been specified in the config node
            node.profilePath = node.voice2JsonConfig.profilePath;
            //check path
            if (!fs.existsSync(node.profilePath)){
                node.error("Profile path doesn't exist. Please check the profile path");
                node_status(["profile path error","red","dot"]);
                return;
            }
        }
        
        node.fileId = node.id.replace(/\./g,"");
        
        if (!fs.existsSync('/dev/shm')) { node.shm = false; }
        
        if(node.autoStart){
            setTimeout(()=>{
                node.warn("starting");
                spawnTranscribe();
                return;
            }, 1500);
        }

        node.on("input", function(msg) {
            
            node.inputMsg = (node.controlField in msg) ? RED.util.getMessageProperty(msg, node.controlField) : RED.util.getMessageProperty(msg, node.inputField);
            
            if (Buffer.isBuffer(node.inpuMsg) && node.inpuMsg.length === 0) { node.warn("ignoring buffer input as its empty"); return; }
            
            node.msgObj = msg;
            
            switch (node.inputMsg){
            
                case "start":
 
                    if(node.transcribeWav){
                        node.warn("restarting");
                        node.transcribeWav.kill();
                        delete node.transcribeWav;
                        setTimeout(()=>{
                            spawnTranscribe();
                            return;
                        }, 1500);
                    } else {
                        node.warn("starting");
                        spawnTranscribe();
                    }
                    return;
                    
                case "stop":
                
                    if(node.transcribeWav){
                    
                        node.warn("stopping");
                        process.kill(-node.transcribeWav.pid);
                        
                    } else {
                        node.warn("not running, nothing to stop");
                    }
                    return;
                    
                default:
            
                    if(node.processingNow == true) {
                        let warnmsg = "Ignoring input message because the previous message is not processed yet";
                        node.warn(warnmsg);
                    } else if(!node.transcribeWav){
                        node.warn("not started, starting now!");
                        spawnTranscribe();
                        setTimeout(()=>{
                            if(typeof node.inputMsg == "string"){
                                writeStdin();
                            } else if(Buffer.isBuffer(node.inputMsg)){
                                saveBufferWrite();
                            }
                            return;
                        }, 1000);
                    } else {
                        if(typeof node.inputMsg == "string"){
                            writeStdin();
                        } else if(Buffer.isBuffer(node.inputMsg)){
                            saveBufferWrite();
                        }
                    }
                    return;
                    
            }  
            
        });
        
        node.on("close",function() {
            node_status();
            
            const checkDir = (node.shm) ? "/dev/shm/" : "/tmp/";
            fs.readdir(checkDir, (err,files) => {
                if (err) { node.error("couldnt check for leftovers in " + checkDir); return; }
                files.forEach(file => {
                    if (file.match(node.fileId)) {
                        try {
                            fs.unlinkSync(checkDir + file);
                        } catch (error) {
                            node.error("couldnt delete leftover " + file);
                        }
                    }
                });
                return;
            });
            
            if(node.transcribeWav) {
                process.kill(-node.transcribeWav.pid);
            }
        });
    }
    RED.nodes.registerType("voice2json-stt", Voice2JsonSpeechToTextNode);
}
