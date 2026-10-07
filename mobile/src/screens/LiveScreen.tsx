import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, PrimaryButton } from "../components/UI";
import { C } from "../theme";

export function LiveScreen() {
  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Coches en tu zona</Text>

      <View style={s.filters}>
        <Pressable style={[s.filter,s.filterActive]}><Ionicons name="car-sport" size={17} color="#fff"/><Text style={s.filterActiveText}>Todos</Text></Pressable>
        <Pressable style={s.filter}><Ionicons name="people-outline" size={17} color={C.blue}/><Text style={s.filterText}>Con plazas</Text></Pressable>
        <Pressable style={s.filter}><Ionicons name="location-outline" size={17} color={C.blue}/><Text style={s.filterText}>Mi destino</Text></Pressable>
      </View>

      <View style={s.map}>
        <View style={[s.road,{left:90,top:28,height:250,transform:[{rotate:"28deg"}]}]}/>
        <View style={[s.road,{left:185,top:10,height:270,transform:[{rotate:"-24deg"}]}]}/>
        <View style={[s.carPin,{left:42,top:75}]}>
          <Ionicons name="car-sport" size={20} color="#fff"/>
        </View>
        <View style={[s.seat,{left:23,top:45}]}><Text style={s.seatText}>2 plazas</Text></View>
        <View style={[s.carPin,{right:42,bottom:58}]}>
          <Ionicons name="car-sport" size={20} color="#fff"/>
        </View>
        <View style={[s.seat,{right:17,bottom:25}]}><Text style={s.seatText}>3 plazas</Text></View>
        <View style={[s.carPin,{left:126,bottom:92,backgroundColor:"#8A98B8"}]}>
          <Ionicons name="car-sport" size={20} color="#fff"/>
        </View>
        <View style={[s.seat,{left:108,bottom:58}]}><Text style={s.seatText}>Completo</Text></View>
        <Text style={s.mapNote}>Ubicación aproximada · mapa ilustrativo</Text>
      </View>

      <Card style={s.driverCard}>
        <View style={s.avatar}><Ionicons name="person" size={30} color="#fff"/></View>
        <View style={{flex:1}}>
          <Text style={s.driverName}>Ana · 2 plazas</Text>
          <Text style={s.green}>● En ruta hacia Sevilla</Text>
          <Text style={s.meta}>◷ Recogida estimada · 8 min</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color={C.blue}/>
      </Card>

      <View style={s.confirm}>
        <Ionicons name="checkmark-circle" size={26} color={C.mint}/>
        <View style={{flex:1}}>
          <Text style={s.confirmTitle}>Reserva confirmada</Text>
          <Text style={s.confirmMeta}>Sigue el coche y acércate al punto acordado.</Text>
        </View>
      </View>

      <View style={s.trackMap}>
        <View style={s.pathA}/>
        <View style={s.pathB}/>
        <View style={[s.pin,{left:65,bottom:45}]}><Ionicons name="location" size={24} color="#fff"/></View>
        <View style={[s.carPin,{right:62,top:54}]}><Ionicons name="car-sport" size={20} color="#fff"/></View>
        <View style={s.etaBox}>
          <Text style={s.etaTitle}>Ana llega en unos 8 min</Text>
          <Text style={s.etaMeta}>Actualizado hace 5 s · 2 plazas disponibles</Text>
        </View>
      </View>

      <PrimaryButton title="Cómo llegar a la recogida" />
    </ScrollView>
  );
}

const s=StyleSheet.create({
  wrap:{padding:18,paddingBottom:32,backgroundColor:"#fff"},
  title:{fontSize:22,fontWeight:"900",color:C.navy,textAlign:"center",marginBottom:14},
  filters:{flexDirection:"row",gap:8,marginBottom:12},
  filter:{flex:1,height:40,borderWidth:1,borderColor:C.border,borderRadius:12,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:5,backgroundColor:"#fff"},
  filterActive:{backgroundColor:C.blue,borderColor:C.blue},
  filterText:{fontSize:11,fontWeight:"800",color:C.navy},
  filterActiveText:{fontSize:11,fontWeight:"800",color:"#fff"},
  map:{height:300,borderRadius:18,backgroundColor:"#EDF2E8",overflow:"hidden",position:"relative",borderWidth:1,borderColor:C.border},
  road:{position:"absolute",width:7,backgroundColor:"#D6D2C7",borderRadius:3},
  carPin:{position:"absolute",width:42,height:42,borderRadius:21,backgroundColor:C.blue,alignItems:"center",justifyContent:"center",borderWidth:4,borderColor:"#fff"},
  seat:{position:"absolute",backgroundColor:"#fff",paddingHorizontal:8,paddingVertical:5,borderRadius:8},
  seatText:{fontSize:11,fontWeight:"900",color:C.navy},
  mapNote:{position:"absolute",left:10,bottom:8,fontSize:10,color:C.muted,backgroundColor:"#ffffffdd",padding:5,borderRadius:7},
  driverCard:{marginTop:12,flexDirection:"row",alignItems:"center",gap:12},
  avatar:{width:54,height:54,borderRadius:27,backgroundColor:"#7BB7A1",alignItems:"center",justifyContent:"center"},
  driverName:{fontSize:16,fontWeight:"900",color:C.navy},
  green:{fontSize:12,fontWeight:"700",color:"#10A66A",marginTop:3},
  meta:{fontSize:12,color:C.muted,marginTop:3},
  confirm:{marginTop:14,backgroundColor:C.mintPale,borderRadius:15,padding:13,flexDirection:"row",gap:10,alignItems:"center"},
  confirmTitle:{fontSize:15,fontWeight:"900",color:C.navy},
  confirmMeta:{fontSize:11,color:C.muted,marginTop:2},
  trackMap:{height:270,marginTop:12,borderRadius:18,backgroundColor:"#E9F1EA",position:"relative",overflow:"hidden",borderWidth:1,borderColor:C.border},
  pathA:{position:"absolute",left:95,top:30,width:7,height:190,backgroundColor:C.blue,transform:[{rotate:"22deg"}]},
  pathB:{position:"absolute",left:132,top:104,width:7,height:120,backgroundColor:C.blue,transform:[{rotate:"-33deg"}]},
  pin:{position:"absolute",width:42,height:42,borderRadius:21,backgroundColor:C.blue,alignItems:"center",justifyContent:"center",borderWidth:4,borderColor:"#fff"},
  etaBox:{position:"absolute",left:16,right:16,bottom:14,backgroundColor:"#fff",padding:12,borderRadius:13},
  etaTitle:{fontSize:14,fontWeight:"900",color:C.navy},
  etaMeta:{fontSize:11,color:C.muted,marginTop:3},
});
