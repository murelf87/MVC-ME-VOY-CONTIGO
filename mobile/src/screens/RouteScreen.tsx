import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, PrimaryButton } from "../components/UI";
import { C } from "../theme";

export function RouteScreen({onLive}:{onLive:()=>void}) {
  const [habitual,setHabitual]=useState(true);
  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Tu ruta en Sevilla</Text>
      <Card style={s.card}>
        <View style={s.pointRow}>
          <Ionicons name="location" size={22} color={C.blue}/>
          <View style={{flex:1}}>
            <Text style={s.pointTitle}>Palomares del Río</Text>
            <Text style={s.pointMeta}>Origen · Sevilla</Text>
          </View>
          <Ionicons name="swap-vertical" size={20} color={C.blue}/>
        </View>
        <View style={s.line}/>
        <View style={s.pointRow}>
          <Ionicons name="flag" size={22} color={C.navy}/>
          <View style={{flex:1}}>
            <Text style={s.pointTitle}>Sevilla</Text>
            <Text style={s.pointMeta}>Destino · Sevilla</Text>
          </View>
        </View>
      </Card>

      <View style={s.map}>
        <Text style={s.mapProvince}>SEVILLA</Text>
        <View style={[s.routeLine,{transform:[{rotate:"-11deg"}]}]}/>
        <View style={[s.mapDot,{left:52,bottom:58}]}/>
        <View style={[s.mapDot,{right:52,top:58}]}/>
        <Text style={[s.mapLabel,{left:24,bottom:26}]}>Palomares del Río</Text>
        <Text style={[s.mapLabel,{right:25,top:26}]}>Sevilla</Text>
      </View>

      <View style={s.ok}>
        <Ionicons name="checkmark-circle" size={25} color={C.mint}/>
        <View style={{flex:1}}>
          <Text style={s.okTitle}>Recorrido dentro de Sevilla</Text>
          <Text style={s.okMeta}>Origen, destino y paradas en la misma provincia.</Text>
        </View>
      </View>

      <Pressable onPress={()=>setHabitual(true)} style={[s.option,habitual&&s.optionActive]}>
        <Ionicons name="calendar" size={23} color={habitual?C.blue:C.muted}/>
        <View style={{flex:1}}>
          <Text style={s.optionTitle}>Ruta habitual</Text>
          <Text style={s.optionMeta}>Repetir cada semana</Text>
        </View>
        <Ionicons name={habitual?"radio-button-on":"radio-button-off"} size={23} color={habitual?C.blue:C.muted}/>
      </Pressable>

      <Pressable onPress={()=>setHabitual(false)} style={[s.option,!habitual&&s.optionActive]}>
        <Ionicons name="calendar-outline" size={23} color={!habitual?C.blue:C.muted}/>
        <View style={{flex:1}}>
          <Text style={s.optionTitle}>Viaje puntual</Text>
          <Text style={s.optionMeta}>Una sola fecha</Text>
        </View>
        <Ionicons name={!habitual?"radio-button-on":"radio-button-off"} size={23} color={!habitual?C.blue:C.muted}/>
      </Pressable>

      <PrimaryButton title="Ver ruta y precio" onPress={onLive}/>
    </ScrollView>
  );
}

const s=StyleSheet.create({
  wrap:{padding:18,paddingBottom:28,backgroundColor:"#fff"},
  title:{fontSize:22,fontWeight:"900",color:C.navy,textAlign:"center",marginBottom:16},
  card:{padding:10},
  pointRow:{flexDirection:"row",alignItems:"center",gap:10,padding:9},
  pointTitle:{fontSize:15,fontWeight:"900",color:C.navy},
  pointMeta:{fontSize:12,color:C.muted,marginTop:2},
  line:{height:1,backgroundColor:C.border,marginLeft:42},
  map:{height:245,borderRadius:18,backgroundColor:"#E8F6EE",marginTop:14,borderWidth:1,borderColor:"#CDE8D6",overflow:"hidden",position:"relative",justifyContent:"center",alignItems:"center"},
  mapProvince:{fontSize:24,fontWeight:"900",letterSpacing:5,color:"#6B8F87"},
  routeLine:{position:"absolute",width:210,height:7,borderRadius:6,backgroundColor:C.blue},
  mapDot:{position:"absolute",width:20,height:20,borderRadius:10,backgroundColor:C.blue,borderWidth:5,borderColor:"#fff"},
  mapLabel:{position:"absolute",fontSize:12,fontWeight:"900",color:C.navy,backgroundColor:"#fff",paddingHorizontal:8,paddingVertical:5,borderRadius:9},
  ok:{marginTop:12,backgroundColor:C.mintPale,borderRadius:15,padding:13,flexDirection:"row",alignItems:"center",gap:10},
  okTitle:{fontSize:14,fontWeight:"900",color:C.navy},
  okMeta:{fontSize:11,color:C.muted,marginTop:2},
  option:{minHeight:70,borderWidth:1,borderColor:C.border,borderRadius:16,marginTop:10,padding:14,flexDirection:"row",alignItems:"center",gap:12},
  optionActive:{borderColor:C.blue,backgroundColor:"#F7FAFF"},
  optionTitle:{fontSize:15,fontWeight:"900",color:C.navy},
  optionMeta:{fontSize:12,color:C.muted,marginTop:2},
});
