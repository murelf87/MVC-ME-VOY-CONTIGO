import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, PrimaryButton } from "../components/UI";
import { C } from "../theme";

export function ProfileScreen() {
  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Tu foto de perfil</Text>

      <View style={s.roleTabs}>
        <Pressable style={[s.role,s.roleActive]}>
          <Ionicons name="car-sport-outline" size={20} color={C.blue}/>
          <Text style={s.roleActiveText}>Conductor</Text>
        </Pressable>
        <Pressable style={s.role}>
          <Ionicons name="person-outline" size={20} color={C.navy}/>
          <Text style={s.roleText}>Pasajero</Text>
        </Pressable>
      </View>

      <View style={s.faces}>
        <View style={s.face}>
          <Ionicons name="person" size={64} color="#fff"/>
        </View>
        <View style={[s.face,{backgroundColor:"#A7D8C5"}]}>
          <Ionicons name="person" size={64} color="#fff"/>
        </View>
      </View>
      <View style={s.faceLabels}>
        <Text style={s.faceLabel}>Conductor</Text>
        <Text style={s.faceLabel}>Pasajera</Text>
      </View>

      <Card style={s.notice}>
        <View style={s.cameraBubble}><Ionicons name="camera" size={26} color={C.blue}/></View>
        <View style={{flex:1}}>
          <Text style={s.noticeTitle}>Foto obligatoria para ambos perfiles.</Text>
          <Text style={s.noticeText}>Rostro visible, sin filtros ni otras personas.</Text>
        </View>
      </Card>

      <View style={s.actions}>
        <Pressable style={s.outlineButton}>
          <Ionicons name="camera-outline" size={20} color={C.blue}/>
          <Text style={s.outlineText}>Hacer foto</Text>
        </Pressable>
        <Pressable style={s.outlineButton}>
          <Ionicons name="images-outline" size={20} color={C.blue}/>
          <Text style={s.outlineText}>Elegir de galería</Text>
        </Pressable>
      </View>

      <Card style={s.privacy}>
        <Ionicons name="information-circle" size={23} color={C.blue}/>
        <Text style={s.privacyText}>La foto de perfil será visible en MVC.</Text>
      </Card>

      <PrimaryButton title="Guardar y continuar"/>

      <Text style={s.sectionTitle}>Comprobación al registrarte</Text>
      <Card style={s.verify}>
        <View style={s.scan}>
          <View style={s.scanFace}><Ionicons name="person" size={70} color="#fff"/></View>
          <View style={s.cornerTL}/><View style={s.cornerTR}/><View style={s.cornerBL}/><View style={s.cornerBR}/>
        </View>
        <Text style={s.centerTitle}>Centra tu rostro</Text>
        <Text style={s.centerMeta}>Sigue las indicaciones de la cámara.</Text>
        <View style={s.privateRow}>
          <Ionicons name="lock-closed" size={22} color={C.blue}/>
          <View style={{flex:1}}>
            <Text style={s.privateTitle}>Selfie privada para comprobar presencia.</Text>
            <Text style={s.privateMeta}>No acredita por sí sola tu identidad.</Text>
          </View>
        </View>
      </Card>
      <Pressable style={s.link}><Text style={s.linkText}>Privacidad y otra forma de verificar</Text><Ionicons name="chevron-forward" size={18} color={C.blue}/></Pressable>
    </ScrollView>
  );
}

const s=StyleSheet.create({
  wrap:{padding:18,paddingBottom:32,backgroundColor:"#fff"},
  title:{fontSize:22,fontWeight:"900",color:C.navy,textAlign:"center",marginBottom:16},
  roleTabs:{flexDirection:"row",gap:8},
  role:{flex:1,height:46,borderRadius:13,borderWidth:1,borderColor:C.border,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:7},
  roleActive:{borderColor:C.blue,backgroundColor:"#F6FAFF"},
  roleText:{fontSize:13,fontWeight:"800",color:C.navy},
  roleActiveText:{fontSize:13,fontWeight:"900",color:C.blue},
  faces:{flexDirection:"row",justifyContent:"space-around",marginTop:22},
  face:{width:116,height:116,borderRadius:58,backgroundColor:"#6D93B9",borderWidth:4,borderColor:"#fff",alignItems:"center",justifyContent:"center"},
  faceLabels:{flexDirection:"row",justifyContent:"space-around",marginTop:6,marginBottom:16},
  faceLabel:{width:116,textAlign:"center",fontSize:14,fontWeight:"900",color:C.navy},
  notice:{backgroundColor:C.pale,flexDirection:"row",gap:12,alignItems:"center"},
  cameraBubble:{width:46,height:46,borderRadius:23,backgroundColor:"#CFE4FF",alignItems:"center",justifyContent:"center"},
  noticeTitle:{fontSize:15,fontWeight:"900",color:C.navy},
  noticeText:{fontSize:12,color:C.muted,marginTop:4},
  actions:{flexDirection:"row",gap:10,marginTop:12},
  outlineButton:{flex:1,height:50,borderRadius:14,borderWidth:1,borderColor:C.blue,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:6},
  outlineText:{fontSize:12,fontWeight:"800",color:C.blue},
  privacy:{marginTop:12,flexDirection:"row",alignItems:"center",gap:9,backgroundColor:"#F7FAFF"},
  privacyText:{fontSize:12,color:C.muted,flex:1},
  sectionTitle:{fontSize:20,fontWeight:"900",color:C.navy,textAlign:"center",marginTop:28,marginBottom:12},
  verify:{alignItems:"center"},
  scan:{width:170,height:170,alignItems:"center",justifyContent:"center",position:"relative"},
  scanFace:{width:138,height:138,borderRadius:69,backgroundColor:"#7597B4",alignItems:"center",justifyContent:"center",borderWidth:4,borderColor:"#fff"},
  cornerTL:{position:"absolute",left:0,top:0,width:28,height:28,borderLeftWidth:4,borderTopWidth:4,borderColor:C.blue,borderTopLeftRadius:9},
  cornerTR:{position:"absolute",right:0,top:0,width:28,height:28,borderRightWidth:4,borderTopWidth:4,borderColor:C.blue,borderTopRightRadius:9},
  cornerBL:{position:"absolute",left:0,bottom:0,width:28,height:28,borderLeftWidth:4,borderBottomWidth:4,borderColor:C.blue,borderBottomLeftRadius:9},
  cornerBR:{position:"absolute",right:0,bottom:0,width:28,height:28,borderRightWidth:4,borderBottomWidth:4,borderColor:C.blue,borderBottomRightRadius:9},
  centerTitle:{fontSize:17,fontWeight:"900",color:C.navy,marginTop:8},
  centerMeta:{fontSize:12,color:C.muted,marginTop:3},
  privateRow:{marginTop:16,backgroundColor:C.pale,borderRadius:14,padding:12,flexDirection:"row",gap:9,alignItems:"center",alignSelf:"stretch"},
  privateTitle:{fontSize:13,fontWeight:"900",color:C.navy},
  privateMeta:{fontSize:11,color:C.muted,marginTop:2},
  link:{marginTop:12,height:48,flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingHorizontal:8},
  linkText:{fontSize:13,fontWeight:"800",color:C.blue},
});
